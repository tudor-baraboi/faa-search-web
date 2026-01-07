// Load polyfills first
import "./polyfills";

import Anthropic from "@anthropic-ai/sdk";
import { Document, RAGResponse, CFRSource, DRSSource } from "./types";
import { createAnthropicClient } from "./anthropic";
import { DRSClient } from "./drsClient";
import { evaluateSearchResults, extractDocumentType, SearchDocument as EvalSearchDocument } from "./searchEvaluator";
import { classifyQuery, QueryClassification, quickClassifyDocumentRequest } from "./queryClassifier";
import { ECFRClient, ECFRSection, getECFRClient } from "./ecfrClient";
import { DocumentCache, getDocumentCache } from "./documentCache";

/**
 * DRS Search Configuration
 * Controls how many documents are fetched based on CFR classification
 */
const DRS_CONFIG = {
  maxCfrQueries: parseInt(process.env.DRS_MAX_CFR_QUERIES || '3'),
  maxDocTypes: parseInt(process.env.DRS_MAX_DOC_TYPES || '2'),
  maxResultsPerSearch: parseInt(process.env.DRS_MAX_RESULTS_PER_SEARCH || '1'),
  maxTotalDocuments: parseInt(process.env.DRS_MAX_TOTAL_DOCUMENTS || '4'),
  maxFreshDownloads: parseInt(process.env.DRS_MAX_FRESH_DOWNLOADS || '2'), // Limit fresh PDF downloads
};

/**
 * Build DRS keyword search terms from CFR classification
 * Uses phrases that commonly appear in AC content like "14 CFR Part 23"
 * Also extracts topic keywords from the classification
 */
function buildDRSKeywords(classification: QueryClassification): string[] {
  const keywords: string[] = [];
  
  // Add CFR part references in common phrasings found in ACs
  // ACs typically reference "14 CFR Part 23" or "Part 23" or "§ 23.xxx"
  if (classification.cfrParts && classification.cfrParts.length > 0) {
    for (const part of classification.cfrParts) {
      // "14 CFR Part 23" is the most common phrasing in ACs
      keywords.push(`14 CFR Part ${part}`);
    }
  }
  
  // Add topic keywords if available (e.g., "stall speed", "airworthiness")
  if (classification.topics && classification.topics.length > 0) {
    for (const topic of classification.topics.slice(0, 3)) {
      keywords.push(topic);
    }
  }
  
  return keywords.slice(0, 10); // DRS API max 10 values per filter
}

export class AircraftCertificationRAG {
  private anthropic: Anthropic;
  private ecfrClient: ECFRClient;
  private cache: DocumentCache;

  constructor() {
    this.anthropic = createAnthropicClient();
    this.ecfrClient = getECFRClient();
    this.cache = getDocumentCache();
  }

  /**
   * Format retrieved documents for Claude
   * Ported from Python: faa-search.py lines 124-133
   */
  formatContext(documents: Document[]): string {
    let context = "# Relevant FAA Regulations and Guidance Material\n\n";

    for (const doc of documents) {
      context += `## Source: ${doc.title}\n`;
      context += `${doc.chunk}\n\n`;
      context += "---\n\n";
    }

    return context;
  }

  /**
   * Main RAG pipeline: classify → parallel fetch → generate answer
   * Now uses intelligent query classification and eCFR integration
   */
  async askQuestion(question: string): Promise<RAGResponse> {
    // Step 1: Check for quick document requests (e.g., "show me AC 23-8C")
    const quickDoc = quickClassifyDocumentRequest(question);
    if (quickDoc.isDocRequest && quickDoc.docType && quickDoc.docNumber) {
      return this.handleDirectDocumentRequest(quickDoc.docType, quickDoc.docNumber);
    }

    // Step 2: Classify the query to understand intent and route to correct sources
    let classification: QueryClassification | null = null;
    let classificationUsed = false;
    
    try {
      console.log('🧠 Classifying query...');
      classification = await classifyQuery(question, this.anthropic);
      classificationUsed = true;
      console.log(`📋 Classification: intent=${classification.intent}, cfrParts=${classification.cfrParts?.join(',') || 'none'}, docTypes=${classification.documentTypes?.join(',') || 'none'}`);
    } catch (error) {
      console.warn('⚠️ Classification failed, using fallback logic:', error);
    }

    // Step 3: Parallel fetch from eCFR and DRS based on classification
    const [ecfrDocs, drsDocs] = await Promise.all([
      this.fetchFromECFR(classification),
      this.fetchFromDRSByClassification(question, classification)
    ]);

    // Combine all documents, prioritizing by source authority
    let allDocs: Document[] = [];
    const cfrSources: CFRSource[] = [];
    const drsSources: DRSSource[] = [];
    
    // eCFR sections (highest authority for regulations)
    for (const section of ecfrDocs) {
      allDocs.push({
        title: `14 CFR § ${section.part}.${section.section} - ${section.sectionTitle}`,
        chunk: section.content,
        score: 1.0
      });
      cfrSources.push({
        title: 14,
        part: section.part,
        section: section.section,
        sectionTitle: section.sectionTitle,
        url: section.url
      });
    }
    
    // DRS documents (high authority for ACs, ADs)
    allDocs = allDocs.concat(drsDocs);

    // Step 4: Handle no results
    if (allDocs.length === 0) {
      // Last resort: try legacy DRS fallback
      console.log('🔄 No documents found, attempting legacy DRS fallback...');
      const legacyResult = await this.fetchFromDRS(question);
      if (legacyResult) {
        allDocs = legacyResult.documents;
      }
    }

    if (allDocs.length === 0) {
      return {
        answer: "I couldn't find relevant information in the FAA regulations, eCFR, or guidance materials. Please try rephrasing your question or specifying a regulation section number.",
        sources: [],
        sourceCount: 0,
        context: "",
        ecfrUsed: ecfrDocs.length > 0,
        classificationUsed
      };
    }

    // Step 5: Format context
    const context = this.formatContext(allDocs);

    // Step 6: Generate answer with Claude
    const systemPrompt = this.buildEnhancedSystemPrompt(ecfrDocs.length > 0, drsDocs.length > 0);

    const userMessage = `${context}

User Question: ${question}

Please answer based on the FAA regulations and guidance materials provided above.`;

    console.log("🤖 Generating answer with Claude...");

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      });

      const answer = response.content[0].type === "text" ? response.content[0].text : "";

      return {
        answer,
        sources: allDocs.map(doc => doc.title),
        sourceCount: allDocs.length,
        context,
        ecfrUsed: ecfrDocs.length > 0,
        cfrSources: cfrSources.length > 0 ? cfrSources : undefined,
        classificationUsed
      };
    } catch (error) {
      console.error("Error generating answer:", error);
      return {
        answer: "",
        sources: [],
        sourceCount: 0,
        context: "",
        error: `Error generating answer: ${error instanceof Error ? error.message : String(error)}`,
        classificationUsed
      };
    }
  }

  /**
   * Handle direct document requests like "show me AC 23-8C"
   */
  private async handleDirectDocumentRequest(docType: string, docNumber: string): Promise<RAGResponse> {
    console.log(`📄 Direct document request: ${docType} ${docNumber}`);
    
    const drsClient = new DRSClient();
    const result = await drsClient.fetchDocumentWithCache(docNumber, docType);
    
    if (!result) {
      return {
        answer: `I couldn't find ${docType} ${docNumber} in the FAA DRS system. Please verify the document number and try again.`,
        sources: [],
        sourceCount: 0,
        context: "",
        fallbackUsed: true
      };
    }

    const context = `## Source: ${result.doc.title}\n\n${result.text}`;
    
    return {
      answer: `Here is ${docType} ${docNumber}:\n\n${result.text.substring(0, 5000)}${result.text.length > 5000 ? '\n\n[Document truncated...]' : ''}`,
      sources: [result.doc.title],
      sourceCount: 1,
      context,
      fallbackUsed: true,
      drsSources: [{
        docType,
        docNumber,
        title: result.doc.title
      }]
    };
  }

  /**
   * Fetch eCFR sections based on classification
   */
  private async fetchFromECFR(classification: QueryClassification | null): Promise<ECFRSection[]> {
    if (!classification) return [];
    
    const sections: ECFRSection[] = [];
    
    // Fetch specific sections mentioned in classification
    if (classification.cfrSections && classification.cfrSections.length > 0) {
      for (const sectionRef of classification.cfrSections) {
        // Parse section reference like "23.2150" or "25.1309"
        const match = sectionRef.match(/(\d+)\.(\d+)/);
        if (match) {
          const part = parseInt(match[1]);
          const section = match[2];
          
          try {
            // Title 14 is always aviation (14 CFR)
            const ecfrSection = await this.ecfrClient.fetchSection(14, part, section);
            if (ecfrSection) {
              sections.push(ecfrSection);
            }
          } catch (error) {
            console.warn(`⚠️ Failed to fetch eCFR § ${part}.${section}:`, error);
          }
        }
      }
    }
    
    return sections;
  }

  /**
   * Fetch DRS documents based on classification
   * Enhanced: Cache-first approach - prioritizes cached documents to minimize latency
   */
  private async fetchFromDRSByClassification(
    question: string,
    classification: QueryClassification | null
  ): Promise<Document[]> {
    if (!classification) {
      return [];
    }
    
    const drsClient = new DRSClient();
    const documents: Document[] = [];
    const fetchedUrls = new Set<string>(); // Deduplicate by download URL
    let freshDownloadCount = 0; // Track fresh PDF downloads (slow operations)
    
    // Helper to add document with deduplication
    const addDocument = (doc: { title: string; chunk: string; score: number }, downloadUrl: string): boolean => {
      if (fetchedUrls.has(downloadUrl)) {
        return false;
      }
      fetchedUrls.add(downloadUrl);
      documents.push(doc);
      return true;
    };
    
    // 1. Extract specific document references from the question (highest priority)
    const docRefs = this.extractDocumentReferences(question);
    
    for (const ref of docRefs) {
      if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
      
      const result = await drsClient.fetchDocumentWithCache(ref.docNumber, ref.docType);
      if (result && result.doc.mainDocumentDownloadURL) {
        const maxChars = 50000;
        const truncatedText = result.text.length > maxChars
          ? result.text.substring(0, maxChars) + "\n\n[Document truncated due to length...]"
          : result.text;
          
        addDocument({
          title: result.doc.title,
          chunk: truncatedText,
          score: 1.0
        }, result.doc.mainDocumentDownloadURL);
      }
    }
    
    // 2. Search for documents using CFR part keywords and topic keywords
    const drsKeywords = buildDRSKeywords(classification);
    const allDocTypes = ['AC', 'TSO', 'Order'] as const;
    const docTypes = (classification.documentTypes && classification.documentTypes.length > 0)
      ? classification.documentTypes.filter(t => t !== 'AD').slice(0, DRS_CONFIG.maxDocTypes)
      : allDocTypes.slice(0, DRS_CONFIG.maxDocTypes);
    
    const cfrParts = classification.cfrParts || [];
    
    if (drsKeywords.length > 0 && documents.length < DRS_CONFIG.maxTotalDocuments) {
      console.log(`📚 CFR→DRS keyword search: keywords=[${drsKeywords.join(', ')}] types=[${docTypes.join(', ')}] parts=[${cfrParts.join(', ')}]`);
      
      // Collect all candidate documents from searches
      interface Candidate {
        result: import('./drsClient').DRSDocument;
        docType: string;
        score: number;
      }
      const candidates: Candidate[] = [];
      
      for (const docType of docTypes) {
        try {
          // For ACs, search Part-specific documents first
          if (docType === 'AC' && cfrParts.length > 0) {
            console.log(`  📌 Starting Part-specific AC search for parts: [${cfrParts.join(', ')}]`);
            for (const part of cfrParts.slice(0, 2)) {
              const topicKeywords = (classification.topics || []).slice(0, 3);
              const searchKeywords = topicKeywords.length > 0 ? topicKeywords : drsKeywords;
              console.log(`  🔎 Part ${part}: searching with keywords=[${searchKeywords.join(', ')}]`);
              
              const searchResults = await drsClient.searchDocumentsFiltered(
                searchKeywords,
                docType,
                { 
                  statusFilter: ['Current'], 
                  maxResults: DRS_CONFIG.maxResultsPerSearch * 5,
                  docNumberPrefix: `AC ${part}-`
                }
              );
              
              console.log(`  📊 Part ${part}: found ${searchResults.length} matching ACs`);
              
              for (const result of searchResults) {
                if (result?.mainDocumentDownloadURL && result?.documentNumber) {
                  candidates.push({ result, docType, score: 0.9 });
                }
              }
            }
          }
          
          // General keyword search
          const searchResults = await drsClient.searchDocumentsFiltered(
            drsKeywords,
            docType,
            { statusFilter: ['Current'], maxResults: DRS_CONFIG.maxResultsPerSearch * 3 }
          );
          
          for (const result of searchResults) {
            if (result?.mainDocumentDownloadURL && result?.documentNumber) {
              candidates.push({ result, docType, score: 0.85 });
            }
          }
        } catch (error) {
          console.warn(`  ⚠️ DRS filtered search for ${docType} failed:`, error);
        }
      }
      
      // Deduplicate candidates by URL
      const uniqueCandidates = candidates.filter((c, i, arr) => 
        arr.findIndex(x => x.result.mainDocumentDownloadURL === c.result.mainDocumentDownloadURL) === i &&
        !fetchedUrls.has(c.result.mainDocumentDownloadURL!)
      );
      
      console.log(`  📋 Found ${uniqueCandidates.length} unique candidates, checking cache...`);
      
      // CACHE-FIRST: Check which candidates are cached (fast parallel check)
      const cacheChecks = await Promise.all(
        uniqueCandidates.map(async c => ({
          ...c,
          isCached: await drsClient.isCached(c.docType, c.result.documentNumber)
        }))
      );
      
      const cachedCandidates = cacheChecks.filter(c => c.isCached);
      const uncachedCandidates = cacheChecks.filter(c => !c.isCached);
      
      console.log(`  📦 Cache status: ${cachedCandidates.length} cached, ${uncachedCandidates.length} need download`);
      
      // Phase 1: Fetch ALL cached documents (fast, no limit)
      for (const c of cachedCandidates) {
        if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
        
        const fetched = await drsClient.fetchDocumentDirect(c.result, c.docType);
        if (fetched) {
          const maxChars = 30000;
          addDocument({
            title: fetched.doc.title,
            chunk: fetched.text.substring(0, maxChars),
            score: c.score
          }, c.result.mainDocumentDownloadURL!);
          console.log(`  📦 Cache hit: ${fetched.doc.title}`);
        }
      }
      
      // Phase 2: Download up to maxFreshDownloads additional uncached documents
      for (const c of uncachedCandidates) {
        if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
        if (freshDownloadCount >= DRS_CONFIG.maxFreshDownloads) {
          console.log(`  ⏸️ Reached fresh download limit (${DRS_CONFIG.maxFreshDownloads}), skipping remaining`);
          break;
        }
        
        const fetched = await drsClient.fetchDocumentDirect(c.result, c.docType);
        if (fetched) {
          freshDownloadCount++;
          const maxChars = 30000;
          addDocument({
            title: fetched.doc.title,
            chunk: fetched.text.substring(0, maxChars),
            score: c.score
          }, c.result.mainDocumentDownloadURL!);
          console.log(`  ⬇️ Downloaded: ${fetched.doc.title} (${freshDownloadCount}/${DRS_CONFIG.maxFreshDownloads})`);
        }
      }
    }
    
    // 3. Fallback: keyword search if no CFR queries and no specific refs found docs
    if (documents.length === 0 && classification.documentTypes && classification.documentTypes.length > 0) {
      console.log(`📚 DRS fallback: keyword search with question text`);
      
      for (const docType of classification.documentTypes.slice(0, DRS_CONFIG.maxDocTypes)) {
        if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
        if (freshDownloadCount >= DRS_CONFIG.maxFreshDownloads) break;
        
        try {
          const searchResults = await drsClient.searchDocuments(question, docType);
          const topResult = searchResults[0];
          if (topResult?.mainDocumentDownloadURL && topResult?.documentNumber) {
            const result = await drsClient.fetchDocumentWithCache(
              topResult.documentNumber, 
              docType
            );
            if (result) {
              const maxChars = 30000;
              addDocument({
                title: result.doc.title,
                chunk: result.text.substring(0, maxChars),
                score: 0.9
              }, topResult.documentNumber);
            }
          }
        } catch (error) {
          console.warn(`⚠️ DRS fallback search for ${docType} failed:`, error);
        }
      }
    }
    
    console.log(`📚 DRS fetch complete: ${documents.length} docs, ${freshDownloadCount} fresh downloads`);
    return documents;
  }

  /**
   * Extract document references from question text
   */
  private extractDocumentReferences(question: string): Array<{ docType: string; docNumber: string }> {
    const refs: Array<{ docType: string; docNumber: string }> = [];
    
    // AC pattern: AC 23-8C, AC23-8, etc.
    const acMatches = question.matchAll(/AC\s*(\d+[A-Z]?[-.]?\d*[A-Z]*)/gi);
    for (const match of acMatches) {
      refs.push({ docType: 'AC', docNumber: match[1] });
    }
    
    // AD pattern: AD 2024-01-02
    const adMatches = question.matchAll(/AD\s*(\d{4}[-]\d{2}[-]\d{2})/gi);
    for (const match of adMatches) {
      refs.push({ docType: 'AD', docNumber: match[1] });
    }
    
    // TSO pattern: TSO-C129
    const tsoMatches = question.matchAll(/TSO[-]?([A-Z]?\d+[A-Z]?)/gi);
    for (const match of tsoMatches) {
      refs.push({ docType: 'TSO', docNumber: match[1] });
    }
    
    return refs;
  }

  /**
   * Build system prompt for Claude, optionally noting DRS source
   */
  private buildSystemPrompt(fromDRS: boolean): string {
    const basePrompt = `You are an FAA aircraft certification expert with deep knowledge of aviation regulations and guidance materials.

Your role is to answer questions based ONLY on the provided FAA regulations, advisory circulars, and guidance documents.

Rules:
1. ALWAYS cite specific regulation sections, advisory circular numbers, or document references when answering
2. If the regulations don't address the question, say so explicitly
3. Never make up information not in the provided documents
4. Be precise about requirements, compliance methods, and specifications
5. If there's ambiguity or multiple acceptable compliance methods, mention them
6. When appropriate, distinguish between:
   - Regulatory requirements (14 CFR sections)
   - Advisory guidance (ACs, policy memos)
   - Acceptable means of compliance
7. If a question involves certification basis or applicability, be specific about which part (Part 23, 25, 27, 29, etc.)
8. Suggest consulting with local FAA Aircraft Certification Office (ACO) or Designated Engineering Representative (DER) when regulations allow for interpretation or require coordination

Answer questions clearly and professionally, as if advising an aircraft manufacturer, engineering team, or certification applicant.`;

    if (fromDRS) {
      return basePrompt + `

Note: The provided document was retrieved directly from the FAA Dynamic Regulatory System (DRS). This is the official, authoritative source for FAA regulatory documents.`;
    }

    return basePrompt;
  }

  /**
   * Enhanced system prompt that notes eCFR and DRS sources
   */
  private buildEnhancedSystemPrompt(hasECFR: boolean, hasDRS: boolean): string {
    let prompt = `You are an FAA aircraft certification expert with deep knowledge of aviation regulations and guidance materials.

Your role is to answer questions based ONLY on the provided FAA regulations, advisory circulars, and guidance documents.

Rules:
1. ALWAYS cite specific regulation sections (e.g., "14 CFR § 23.2150") or advisory circular numbers when answering
2. If the regulations don't address the question, say so explicitly  
3. Never make up information not in the provided documents
4. Be precise about requirements, compliance methods, and specifications
5. If there's ambiguity or multiple acceptable compliance methods, mention them
6. When appropriate, distinguish between:
   - Regulatory requirements (14 CFR sections)
   - Advisory guidance (ACs, policy memos)
   - Acceptable means of compliance
7. If a question involves certification basis or applicability, be specific about which part (Part 23, 25, 27, 29, etc.)
8. Suggest consulting with local FAA Aircraft Certification Office (ACO) or Designated Engineering Representative (DER) when regulations allow for interpretation or require coordination

Answer questions clearly and professionally, as if advising an aircraft manufacturer, engineering team, or certification applicant.`;

    if (hasECFR) {
      prompt += `

IMPORTANT: Some content is from the official Electronic Code of Federal Regulations (eCFR). This is the authoritative, current regulatory text. Always cite these as "14 CFR § X.XXX".`;
    }

    if (hasDRS) {
      prompt += `

Note: Some documents were retrieved from the FAA Dynamic Regulatory System (DRS), the official source for FAA advisory circulars and directives.`;
    }

    return prompt;
  }

  /**
   * Fetch document from FAA DRS API
   */
  private async fetchFromDRS(
    question: string,
    specificDoc?: string
  ): Promise<{ documents: Document[] } | null> {
    const drsClient = new DRSClient();

    // Determine document type from query
    const docType = extractDocumentType(question);
    console.log(`📡 Searching DRS for: "${question}" (type: ${docType || 'default'})`);

    try {
      // Search DRS for relevant documents
      const drsResults = await drsClient.searchDocuments(question, docType);

      if (drsResults.length === 0) {
        console.log('⚠️ No documents found in DRS');
        return null;
      }

      // Get the top result that has a download URL
      const topResult = drsResults.find(doc => doc.mainDocumentDownloadURL);
      if (!topResult || !topResult.mainDocumentDownloadURL) {
        console.log('⚠️ No downloadable document found in DRS results');
        return null;
      }
      console.log(`📥 Downloading: ${topResult.title}`);

      // Download and extract PDF content
      const pdfBuffer = await drsClient.downloadDocument(topResult.mainDocumentDownloadURL);
      const pdfText = await drsClient.extractTextFromPDF(pdfBuffer);

      // Truncate if too long (Claude has context limits)
      const maxChars = 50000;
      const truncatedText = pdfText.length > maxChars
        ? pdfText.substring(0, maxChars) + "\n\n[Document truncated due to length...]"
        : pdfText;

      return {
        documents: [{
          title: topResult.title,
          chunk: truncatedText,
          score: 1.0  // Direct fetch, highest relevance
        }]
      };
    } catch (error) {
      console.error('❌ DRS fetch error:', error);
      throw error;
    }
  }
}
