// Load polyfills first
import "./polyfills";

import { SearchClient } from "@azure/search-documents";
import Anthropic from "@anthropic-ai/sdk";
import { Document, RAGResponse, SearchDocument, CFRSource, DRSSource } from "./types";
import { createSearchClient } from "./azureSearch";
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
};

/**
 * Build DRS search queries from CFR classification
 * Prioritizes sections (more specific) over parts (broader)
 */
function buildCFRSearchQueries(classification: QueryClassification): string[] {
  const queries: string[] = [];
  
  // Sections are most specific (e.g., "23.2150")
  if (classification.cfrSections) {
    for (const section of classification.cfrSections) {
      if (queries.length >= DRS_CONFIG.maxCfrQueries) break;
      queries.push(section);
    }
  }
  
  // Parts are broader (e.g., "Part 23")
  if (classification.cfrParts) {
    for (const part of classification.cfrParts) {
      if (queries.length >= DRS_CONFIG.maxCfrQueries) break;
      queries.push(`Part ${part}`);
    }
  }
  
  return queries;
}

export class AircraftCertificationRAG {
  private searchClient: SearchClient<SearchDocument>;
  private anthropic: Anthropic;
  private ecfrClient: ECFRClient;
  private cache: DocumentCache;

  constructor() {
    this.searchClient = createSearchClient();
    this.anthropic = createAnthropicClient();
    this.ecfrClient = getECFRClient();
    this.cache = getDocumentCache();
  }

  /**
   * Search vector database for relevant FAA regulation sections
   * Ported from Python: faa-search.py lines 87-122
   */
  async searchFAARegulations(query: string, topK: number = 3): Promise<Document[]> {
    console.log(`🔍 Searching FAA regulations for: '${query}'`);

    try {
      // Try vector search first
      console.log('  Attempting vector search...');
      const vectorResults = await this.searchClient.search(query, {
        vectorQueries: [
          {
            kind: "text",
            text: query,
            kNearestNeighborsCount: topK,
            fields: ["text_vector"]
          }
        ],
        select: ["chunk", "title"],
        top: topK
      } as any);

      // Format results
      const retrievedDocs: Document[] = [];
      for await (const result of vectorResults.results) {
        retrievedDocs.push({
          chunk: result.document.chunk || "",
          title: result.document.title || "Unknown",
          score: result.score || 0
        });
      }

      if (retrievedDocs.length > 0) {
        console.log(`  ✓ Found ${retrievedDocs.length} relevant regulation sections via vector search`);
        return retrievedDocs;
      }

      // Fallback to keyword search if vector search returns nothing
      console.log('  Vector search returned 0 results, falling back to keyword search...');
      const keywordResults = await this.searchClient.search(query, {
        select: ["chunk", "title"],
        top: topK
      });

      const keywordDocs: Document[] = [];
      for await (const result of keywordResults.results) {
        keywordDocs.push({
          chunk: result.document.chunk || "",
          title: result.document.title || "Unknown",
          score: result.score || 0
        });
      }

      console.log(`  ✓ Found ${keywordDocs.length} relevant regulation sections via keyword search`);
      return keywordDocs;
    } catch (error) {
      console.error(`  ❌ Search error:`, error);
      if (error instanceof Error) {
        console.error(`  ❌ Error message: ${error.message}`);
        console.error(`  ❌ Error stack: ${error.stack}`);
      }
      // Re-throw the error so we can see it in the response
      throw error;
    }
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

    // Step 3: Parallel fetch from multiple sources based on classification
    const [ecfrDocs, drsDocs, searchDocs] = await Promise.all([
      this.fetchFromECFR(classification),
      this.fetchFromDRSByClassification(question, classification),
      this.searchFAARegulations(question).catch(err => {
        console.warn('⚠️ Azure Search failed:', err);
        return [] as Document[];
      })
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
    
    // Azure Search results (supplement)
    if (searchDocs.length > 0 && ecfrDocs.length === 0 && drsDocs.length === 0) {
      // Only use search results if we didn't get specific documents
      allDocs = allDocs.concat(searchDocs);
    }

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
        fallbackUsed: drsDocs.length > 0 && searchDocs.length === 0,
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
   * Enhanced: Searches for documents related to CFR parts/sections
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
    const fetchedDocNumbers = new Set<string>(); // Deduplication
    
    // Helper to add document with deduplication and limit check
    const addDocument = (doc: { title: string; chunk: string; score: number }, docNumber: string): boolean => {
      if (fetchedDocNumbers.has(docNumber) || documents.length >= DRS_CONFIG.maxTotalDocuments) {
        return false;
      }
      fetchedDocNumbers.add(docNumber);
      documents.push(doc);
      return true;
    };
    
    // 1. Extract specific document references from the question (highest priority)
    const docRefs = this.extractDocumentReferences(question);
    
    for (const ref of docRefs) {
      if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
      
      const result = await drsClient.fetchDocumentWithCache(ref.docNumber, ref.docType);
      if (result) {
        const maxChars = 50000;
        const truncatedText = result.text.length > maxChars
          ? result.text.substring(0, maxChars) + "\n\n[Document truncated due to length...]"
          : result.text;
          
        addDocument({
          title: result.doc.title,
          chunk: truncatedText,
          score: 1.0
        }, ref.docNumber);
      }
    }
    
    // 2. NEW: Search for documents related to CFR parts/sections from classifier
    const cfrQueries = buildCFRSearchQueries(classification);
    // Default to AC if no document types specified (ACs provide compliance guidance for CFRs)
    const docTypes = (classification.documentTypes && classification.documentTypes.length > 0)
      ? classification.documentTypes.slice(0, DRS_CONFIG.maxDocTypes)
      : ['AC'];
    
    if (cfrQueries.length > 0 && documents.length < DRS_CONFIG.maxTotalDocuments) {
      console.log(`📚 CFR→DRS mapping: searching ${cfrQueries.length} queries × ${docTypes.length} types`);
      
      for (const query of cfrQueries) {
        if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
        
        for (const docType of docTypes) {
          if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
          
          try {
            console.log(`  🔍 Searching DRS: "${query}" in ${docType}`);
            const searchResults = await drsClient.searchDocuments(query, docType);
            const topResults = searchResults.slice(0, DRS_CONFIG.maxResultsPerSearch);
            
            for (const result of topResults) {
              if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
              if (!result?.mainDocumentDownloadURL || !result?.documentNumber) continue;
              if (fetchedDocNumbers.has(result.documentNumber)) continue;
              
              const fetched = await drsClient.fetchDocumentWithCache(
                result.documentNumber,
                docType
              );
              
              if (fetched) {
                const maxChars = 30000;
                addDocument({
                  title: fetched.doc.title,
                  chunk: fetched.text.substring(0, maxChars),
                  score: 0.85
                }, result.documentNumber);
                console.log(`  ✅ Found: ${fetched.doc.title}`);
              }
            }
          } catch (error) {
            console.warn(`  ⚠️ DRS search for "${query}" in ${docType} failed:`, error);
          }
        }
      }
    }
    
    // 3. Fallback: keyword search if no CFR queries and no specific refs found docs
    if (documents.length === 0 && classification.documentTypes && classification.documentTypes.length > 0) {
      console.log(`📚 DRS fallback: keyword search with question text`);
      
      for (const docType of classification.documentTypes.slice(0, DRS_CONFIG.maxDocTypes)) {
        if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
        
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
    
    console.log(`📚 DRS fetch complete: ${documents.length} documents (limit: ${DRS_CONFIG.maxTotalDocuments})`);
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
