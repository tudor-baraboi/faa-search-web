// Load polyfills first
import "./polyfills";

import Anthropic from "@anthropic-ai/sdk";
import { Document, RAGResponse, CFRSource, DRSSource, StoredConversation } from "./types";
import { createAnthropicClient } from "./anthropic";
import { DRSClient, DRSDocument } from "./drsClient";
import { evaluateSearchResults, extractDocumentType, SearchDocument as EvalSearchDocument } from "./searchEvaluator";
import { classifyQuery, QueryClassification, quickClassifyDocumentRequest } from "./queryClassifier";
import { ECFRClient, ECFRSection, getECFRClient } from "./ecfrClient";
import { DocumentCache, getDocumentCache } from "./documentCache";
import { getConversationStore } from "./conversationStore";
import { hybridSearch, indexDocuments, ensureIndexExists, hasVectorSearch, FADocument, getIndexedDocumentNumbers } from "./vectorSearch";
import { hasEmbeddingService } from "./embeddings";
import { enqueueForIndexing, hasIndexQueue } from "./indexQueue";

/**
 * DRS Search Configuration
 * Controls how many documents are fetched based on CFR classification
 */
const DRS_CONFIG = {
  maxCfrQueries: parseInt(process.env.DRS_MAX_CFR_QUERIES || '4'),
  maxDocTypes: parseInt(process.env.DRS_MAX_DOC_TYPES || '2'),
  maxResultsPerSearch: parseInt(process.env.DRS_MAX_RESULTS_PER_SEARCH || '2'),
  maxTotalDocuments: parseInt(process.env.DRS_MAX_TOTAL_DOCUMENTS || '6'),
  maxFreshDownloads: parseInt(process.env.DRS_MAX_FRESH_DOWNLOADS || '4'), // Limit fresh PDF downloads
};

/**
 * Vector Search Configuration
 * Controls when to use vector search vs fall back to live APIs
 */
const VECTOR_SEARCH_CONFIG = {
  enabled: process.env.VECTOR_SEARCH_ENABLED !== 'false', // Enabled by default
  minScoreThreshold: parseFloat(process.env.VECTOR_SEARCH_MIN_SCORE || '0.01'), // Min relevance score (Azure Search uses lower scores)
  minResultsRequired: parseInt(process.env.VECTOR_SEARCH_MIN_RESULTS || '2'), // Min docs needed
  maxResults: parseInt(process.env.VECTOR_SEARCH_MAX_RESULTS || '8'), // Max docs to retrieve
  indexNewDocuments: process.env.VECTOR_INDEX_NEW_DOCS !== 'false', // Index fetched docs
};

/**
 * Progressive Indexing Configuration
 * Incrementally build index over multiple queries
 */
const PROGRESSIVE_INDEX_CONFIG = {
  enabled: process.env.PROGRESSIVE_INDEX_ENABLED !== 'false', // Enabled by default
  maxIndexedPerTopic: parseInt(process.env.PROGRESSIVE_MAX_INDEXED || '100'), // Cap total indexed docs per topic
  batchSize: parseInt(process.env.PROGRESSIVE_BATCH_SIZE || '4'), // Docs to download per query
};

/**
 * Clarity check configuration
 * Stage 1: Pre-fetch (classifier confidence)
 * Stage 2: Post-fetch (too many or too few results)
 */
const CLARITY_CONFIG = {
  minConfidenceForClear: 0.6,     // Below this, consider asking for clarification
  maxDocsBeforeClarify: 6,        // If we'd fetch more than this, ask user to narrow down
  minDocsForGoodAnswer: 1,        // Below this, results may be insufficient
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
   * Now supports multi-turn conversations with clarifying questions
   */
  async askQuestion(
    question: string, 
    options: { sessionId?: string; isClarifying?: boolean; conversation?: StoredConversation | null } = {}
  ): Promise<RAGResponse> {
    const { sessionId, isClarifying = false, conversation = null } = options;
    
    // Step 1: Check for quick document requests (e.g., "show me AC 23-8C")
    const quickDoc = quickClassifyDocumentRequest(question);
    if (quickDoc.isDocRequest && quickDoc.docType && quickDoc.docNumber) {
      const response = await this.handleDirectDocumentRequest(quickDoc.docType, quickDoc.docNumber);
      return { ...response, sessionId };
    }

    // Step 2: Classify the query to understand intent and route to correct sources
    let classification: QueryClassification | null = null;
    let classificationUsed = false;
    
    try {
      console.log('🧠 Classifying query...');
      // If this is a clarifying response, include conversation context in classification
      const classifyQuestion = conversation && conversation.turns.length > 0
        ? this.buildQuestionWithContext(question, conversation)
        : question;
      classification = await classifyQuery(classifyQuestion, this.anthropic);
      classificationUsed = true;
      console.log(`📋 Classification: intent=${classification.intent}, cfrParts=${classification.cfrParts?.join(',') || 'none'}, confidence=${classification.confidence}, needsClarification=${classification.needsClarification}`);
    } catch (error) {
      console.warn('⚠️ Classification failed, using fallback logic:', error);
    }

    // Step 3: Stage 1 Clarity Check (pre-fetch)
    // Only ask for clarification if:
    // - Classifier says it needs clarification AND
    // - This is NOT already a response to a clarifying question AND
    // - Confidence is below threshold
    if (
      classification?.needsClarification && 
      !isClarifying && 
      classification.confidence < CLARITY_CONFIG.minConfidenceForClear
    ) {
      console.log(`🤔 Stage 1: Query needs clarification (confidence: ${classification.confidence})`);
      const clarifyingQuestion = classification.suggestedQuestion || 
        "Could you be more specific about what you're looking for? For example, which CFR Part (23, 25, etc.) or which aspect of the regulation?";
      
      return {
        answer: clarifyingQuestion,
        sources: [],
        sourceCount: 0,
        context: "",
        sessionId,
        needsClarification: true,
        clarifyingQuestion,
        classificationUsed
      };
    }

    // Step 4: Try vector search first (if enabled and available)
    let vectorDocs: Document[] = [];
    let vectorSources: { cfrSources: CFRSource[], drsSources: DRSSource[] } = { cfrSources: [], drsSources: [] };
    let vectorSearchUsed = false;
    
    if (VECTOR_SEARCH_CONFIG.enabled && hasVectorSearch() && hasEmbeddingService()) {
      try {
        console.log('🔍 Attempting vector search...');
        const vectorResults = await hybridSearch(question, { top: VECTOR_SEARCH_CONFIG.maxResults });
        
        // Filter by minimum score threshold
        const relevantResults = vectorResults.filter(r => (r.score || 0) >= VECTOR_SEARCH_CONFIG.minScoreThreshold);
        
        if (relevantResults.length >= VECTOR_SEARCH_CONFIG.minResultsRequired) {
          console.log(`✅ Vector search found ${relevantResults.length} relevant docs (scores: ${relevantResults.map(r => r.score?.toFixed(2)).join(', ')})`);
          vectorSearchUsed = true;
          
          // Dedupe chunks from same parent document - keep highest scoring chunk per doc
          const seenParentDocs = new Map<string, { doc: FADocument; score: number }>();
          for (const result of relevantResults) {
            const doc = result.document;
            const parentId = doc.documentId || doc.id; // Use documentId for chunks, id for non-chunked
            const existing = seenParentDocs.get(parentId);
            
            if (!existing || (result.score || 0) > existing.score) {
              seenParentDocs.set(parentId, { doc, score: result.score || 0 });
            }
          }
          
          const dedupedResults = Array.from(seenParentDocs.values());
          console.log(`📄 Deduped to ${dedupedResults.length} unique documents from ${relevantResults.length} chunks`);
          
          for (const { doc, score } of dedupedResults) {
            vectorDocs.push({
              title: doc.title,
              chunk: doc.content,
              score: score
            });
            
            // Track sources by type
            if (doc.documentType === 'eCFR' && doc.cfrPart && doc.cfrSection) {
              vectorSources.cfrSources.push({
                title: 14,
                part: doc.cfrPart,
                section: doc.cfrSection,
                sectionTitle: doc.title.replace(/^14 CFR § \d+\.\d+ - /, ''),
                url: doc.source || ''
              });
            } else if (doc.documentType && doc.documentNumber) {
              vectorSources.drsSources.push({
                docType: doc.documentType,
                docNumber: doc.documentNumber,
                title: doc.title
              });
            }
          }
        } else {
          console.log(`⚠️ Vector search found only ${relevantResults.length} docs above threshold (need ${VECTOR_SEARCH_CONFIG.minResultsRequired}), falling back to live APIs`);
        }
      } catch (error) {
        console.warn('⚠️ Vector search failed, falling back to live APIs:', error);
      }
    } else {
      const reasons = [];
      if (!VECTOR_SEARCH_CONFIG.enabled) reasons.push('disabled');
      if (!hasVectorSearch()) reasons.push('no search service');
      if (!hasEmbeddingService()) reasons.push('no embedding service');
      console.log(`ℹ️ Vector search skipped (${reasons.join(', ')})`);
    }

    // Step 5: Parallel fetch from eCFR and DRS (if vector search didn't find enough)
    let ecfrDocs: ECFRSection[] = [];
    let drsDocs: Document[] = [];
    let progressiveDocs: Document[] = [];
    
    // ALWAYS fetch CFRs when classifier identifies specific sections
    // CFRs are authoritative regulatory text and should always be included
    if (classification?.cfrSections && classification.cfrSections.length > 0) {
      console.log(`📡 Fetching ${classification.cfrSections.length} CFR sections identified by classifier...`);
      ecfrDocs = await this.fetchFromECFR(classification);
      
      // Index newly fetched CFRs for future queries
      if (ecfrDocs.length > 0 && VECTOR_SEARCH_CONFIG.indexNewDocuments && hasVectorSearch() && hasEmbeddingService()) {
        this.indexFetchedDocuments(ecfrDocs, []).catch(err => 
          console.warn('⚠️ Background indexing of CFRs failed:', err)
        );
      }
    }
    
    if (!vectorSearchUsed || vectorDocs.length < VECTOR_SEARCH_CONFIG.minResultsRequired) {
      console.log('📡 Fetching from live APIs (DRS)...');
      drsDocs = await this.fetchFromDRSByClassification(question, classification);
      
      // Step 5b: Index newly fetched DRS documents for future queries
      if (drsDocs.length > 0 && VECTOR_SEARCH_CONFIG.indexNewDocuments && hasVectorSearch() && hasEmbeddingService()) {
        this.indexFetchedDocuments([], drsDocs).catch(err => 
          console.warn('⚠️ Background indexing failed:', err)
        );
      }
    } else {
      console.log('✅ Using vector search results');
      
      // Step 5c: Progressive indexing - fetch next batch of unindexed DRS documents
      // This incrementally builds the index over multiple queries
      if (classification && PROGRESSIVE_INDEX_CONFIG.enabled) {
        console.log('🔄 Checking for new documents to index progressively...');
        progressiveDocs = await this.fetchNewDocumentsProgressively(classification);
      }
    }

    // Combine all documents, prioritizing by source authority
    let allDocs: Document[] = [];
    const cfrSources: CFRSource[] = [];
    const drsSources: DRSSource[] = [];
    
    // First: Add vector search results (already filtered by relevance)
    if (vectorSearchUsed && vectorDocs.length > 0) {
      allDocs = allDocs.concat(vectorDocs);
      cfrSources.push(...vectorSources.cfrSources);
      drsSources.push(...vectorSources.drsSources);
    }
    
    // Add progressively fetched documents (new unindexed docs)
    if (progressiveDocs.length > 0) {
      allDocs = allDocs.concat(progressiveDocs);
      // Track sources from progressive docs
      for (const doc of progressiveDocs) {
        if (doc.docType && doc.docNumber) {
          drsSources.push({
            docType: doc.docType,
            docNumber: doc.docNumber,
            title: doc.title
          });
        }
      }
    }
    
    // Then: eCFR sections from live API (highest authority for regulations)
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
    
    // Finally: DRS documents from live API (high authority for ACs, ADs)
    allDocs = allDocs.concat(drsDocs);

    // Step 6: Handle no results
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
        sessionId,
        ecfrUsed: ecfrDocs.length > 0,
        classificationUsed
      };
    }

    // Step 6: Format context (include conversation history if available)
    let context = this.formatContext(allDocs);
    
    // Add full conversation history to context - agent always has access to complete conversation
    const conversationStore = getConversationStore();
    const conversationContext = conversationStore.formatForContext(conversation);
    
    if (conversationContext) {
      context = conversationContext + "\n\n" + context;
    }

    // Step 7: Generate answer with Claude
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
        sessionId,
        ecfrUsed: ecfrDocs.length > 0 || vectorSources.cfrSources.length > 0,
        cfrSources: cfrSources.length > 0 ? cfrSources : undefined,
        drsSources: drsSources.length > 0 ? drsSources : undefined,
        classificationUsed,
        vectorSearchUsed
      };
    } catch (error) {
      console.error("Error generating answer:", error);
      
      // Re-throw rate limit errors so the HTTP handler can return 429
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('429') || errorMessage.includes('rate_limit') || errorMessage.includes('rate limit')) {
        throw error;
      }
      
      return {
        answer: "",
        sources: [],
        sourceCount: 0,
        context: "",
        sessionId,
        error: `Error generating answer: ${errorMessage}`,
        classificationUsed
      };
    }
  }

  /**
   * Build question with conversation context for the classifier
   * Preserves the original question topic and recent exchanges
   */
  private buildQuestionWithContext(question: string, conversation: StoredConversation): string {
    if (conversation.turns.length === 0) return question;
    
    let contextStr = "This is a follow-up question in an ongoing conversation.\n\n";
    
    // Always include the FIRST user question (original topic)
    const firstUserTurn = conversation.turns.find(t => t.role === 'user');
    if (firstUserTurn) {
      contextStr += `Original question: ${firstUserTurn.content}\n\n`;
    }
    
    // Include recent turns (last 6) with more generous content limits
    const recentTurns = conversation.turns.slice(-6);
    if (recentTurns.length > 0) {
      contextStr += "Recent conversation:\n";
      for (const turn of recentTurns) {
        const role = turn.role === 'user' ? 'User' : 'Assistant';
        // Allow longer content (500 chars) to preserve important details
        const content = turn.content.length > 500 ? turn.content.substring(0, 500) + '...' : turn.content;
        contextStr += `${role}: ${content}\n`;
      }
    }
    
    return `${contextStr}\nCurrent question: ${question}`;
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
        context: ""
      };
    }

    const context = `## Source: ${result.doc.title}\n\n${result.text}`;
    
    return {
      answer: `Here is ${docType} ${docNumber}:\n\n${result.text.substring(0, 5000)}${result.text.length > 5000 ? '\n\n[Document truncated...]' : ''}`,
      sources: [result.doc.title],
      sourceCount: 1,
      context,
      drsSources: [{
        docType,
        docNumber,
        title: result.doc.title
      }]
    };
  }

  /**
   * Progressive indexing: fetch next batch of unindexed documents
   * Even when vector search succeeds, check DRS metadata for new documents
   * to incrementally build the index over multiple queries.
   * 
   * Also fetches CFR sections from eCFR API and indexes them.
   * 
   * LAZY MODE: With queue enabled, enqueue DRS documents for background processing
   * instead of downloading inline. CFRs are always fetched inline (small, fast).
   * 
   * @returns Array of newly fetched documents (empty in lazy mode - docs indexed async)
   */
  private async fetchNewDocumentsProgressively(
    classification: QueryClassification
  ): Promise<Document[]> {
    if (!PROGRESSIVE_INDEX_CONFIG.enabled) {
      return [];
    }

    const drsClient = new DRSClient();

    try {
      // NOTE: CFR progressive indexing is now handled in the main processQuestion flow
      // CFRs are always fetched when identified by classifier, not just during progressive indexing

      // === DRS PROGRESSIVE INDEXING ===
      // 1. Get document types to search for
      const allDocTypes = ['AC', 'TSO', 'Order'] as const;
      const docTypes = (classification.documentTypes && classification.documentTypes.length > 0)
        ? classification.documentTypes.filter(t => t !== 'AD').slice(0, 2)
        : allDocTypes.slice(0, 2);

      // 2. Build keywords from classification
      const keywords: string[] = [];
      if (classification.topics) keywords.push(...classification.topics.slice(0, 3));
      if (classification.cfrParts) {
        keywords.push(...classification.cfrParts.map(p => `14 CFR Part ${p}`));
      }
      if (keywords.length === 0) return [];

      // 3. Get already-indexed document numbers from vector store
      const indexedDocNumbers = await getIndexedDocumentNumbers();
      console.log(`📋 Progressive indexing: ${indexedDocNumbers.size} docs already indexed`);

      // Check if we've hit the cap
      if (indexedDocNumbers.size >= PROGRESSIVE_INDEX_CONFIG.maxIndexedPerTopic) {
        console.log(`📊 Index cap reached (${PROGRESSIVE_INDEX_CONFIG.maxIndexedPerTopic}), skipping progressive fetch`);
        return [];
      }

      // 4. Query DRS for metadata (no PDF download yet)
      let metadataResults: { doc: DRSDocument; docType: string }[] = [];
      
      for (const docType of docTypes) {
        const results = await drsClient.searchDocumentsFiltered(
          keywords,
          docType,
          { statusFilter: ['Current'], maxResults: 50 }
        );
        
        for (const doc of results) {
          metadataResults.push({ doc, docType });
        }
      }

      console.log(`📡 DRS metadata check: found ${metadataResults.length} potential documents`);

      // 5. Filter out already-indexed documents
      const unindexedDocs = metadataResults.filter(({ doc }) => {
        const normalizedNumber = doc.documentNumber.replace(/^(AC|AD|TSO|Order)\s*/i, '').trim().toUpperCase();
        return !indexedDocNumbers.has(normalizedNumber);
      });

      console.log(`🆕 Found ${unindexedDocs.length} unindexed documents`);

      if (unindexedDocs.length === 0) {
        return [];
      }

      // 6. Take next batch (top N by relevance order from DRS)
      const batchToFetch = unindexedDocs.slice(0, PROGRESSIVE_INDEX_CONFIG.batchSize);

      // 7. LAZY MODE: Enqueue for background processing if queue is available
      if (hasIndexQueue()) {
        console.log(`📬 Enqueueing ${batchToFetch.length} documents for background indexing...`);
        await enqueueForIndexing(batchToFetch);
        // Return empty - documents will be indexed asynchronously
        return [];
      }

      // 8. FALLBACK: Inline download if queue not available (original behavior)
      console.log(`📥 Fetching ${batchToFetch.length} new documents inline (queue not available)...`);
      const newDocs: Document[] = [];
      let downloadCount = 0;
      
      for (const { doc, docType } of batchToFetch) {
        if (!doc.mainDocumentDownloadURL) continue;

        try {
          const result = await drsClient.fetchDocumentDirect(doc, docType);
          if (result) {
            downloadCount++;
            const maxChars = 50000;
            const truncatedText = result.text.length > maxChars
              ? result.text.substring(0, maxChars) + "\n\n[Document truncated due to length...]"
              : result.text;

            newDocs.push({
              title: doc.title,
              chunk: truncatedText,
              score: 0.9,
              docType: docType,
              docNumber: doc.documentNumber
            });

            console.log(`  ⬇️ Downloaded: ${docType} ${doc.documentNumber} (${downloadCount}/${batchToFetch.length})`);
          }
        } catch (err) {
          console.warn(`  ⚠️ Failed to download ${docType} ${doc.documentNumber}:`, err);
        }
      }

      console.log(`✅ Progressive fetch complete: ${newDocs.length} new documents`);

      // 9. Index newly fetched documents in background (inline mode only)
      if (newDocs.length > 0 && hasVectorSearch() && hasEmbeddingService()) {
        this.indexFetchedDocuments([], newDocs).catch(err =>
          console.warn('⚠️ Background indexing of progressive docs failed:', err)
        );
      }

      return newDocs;
    } catch (error) {
      console.warn('⚠️ Progressive indexing check failed:', error);
      return [];
    }
  }

  /**
   * Index newly fetched documents for future vector search queries
   * Runs in background to avoid blocking the response
   */
  private async indexFetchedDocuments(
    ecfrSections: ECFRSection[], 
    drsDocs: Document[]
  ): Promise<void> {
    const { generateEmbeddings } = await import('./embeddings');
    const { indexDocuments: indexToVectorDB } = await import('./vectorSearch');
    
    const docsToIndex: FADocument[] = [];
    
    // Convert eCFR sections to indexable format
    for (const section of ecfrSections) {
      const docId = `ecfr-14-${section.part}-${section.section}`;
      docsToIndex.push({
        id: docId,
        documentType: 'eCFR',
        title: `14 CFR § ${section.part}.${section.section} - ${section.sectionTitle}`,
        content: section.content,
        cfrPart: section.part,
        cfrSection: section.section,
        source: section.url,
        lastIndexed: new Date()
      });
    }
    
    // Convert DRS documents to indexable format
    // Now uses structured metadata from Document instead of parsing title
    for (const doc of drsDocs) {
      // Use metadata if available, skip if not (shouldn't happen with new code)
      if (doc.docType && doc.docNumber) {
        const docId = `drs-${doc.docType.toLowerCase()}-${doc.docNumber.replace(/[^a-zA-Z0-9]/g, '-')}`;
        
        docsToIndex.push({
          id: docId,
          documentType: doc.docType,
          documentNumber: doc.docNumber,
          title: doc.title,
          content: doc.chunk,
          source: `FAA DRS`,
          lastIndexed: new Date(),
          // Include additional metadata if available
          revision: doc.revision,
          changeNumber: doc.changeNumber,
          status: doc.status
        });
      } else {
        // Fallback: try to parse from title for backwards compatibility
        const match = doc.title.match(/^(AC|TSO|Order|AD)\s*([^\s-]+(?:-[^\s]+)?)/i);
        if (match) {
          const docType = match[1].toUpperCase();
          const docNumber = match[2];
          const docId = `drs-${docType.toLowerCase()}-${docNumber.replace(/[^a-zA-Z0-9]/g, '-')}`;
          
          docsToIndex.push({
            id: docId,
            documentType: docType,
            documentNumber: docNumber,
            title: doc.title,
            content: doc.chunk,
            source: `FAA DRS`,
            lastIndexed: new Date()
          });
        }
      }
    }
    
    if (docsToIndex.length === 0) {
      return;
    }
    
    console.log(`📥 Indexing ${docsToIndex.length} documents for vector search...`);
    
    try {
      // Generate embeddings for all documents
      const embeddings = await generateEmbeddings(docsToIndex.map(d => d.content));
      
      // Add embeddings to documents
      const docsWithEmbeddings = docsToIndex.map((doc, i) => ({
        ...doc,
        contentVector: embeddings[i]
      }));
      
      // Index in vector store
      await indexToVectorDB(docsWithEmbeddings);
      console.log(`✅ Successfully indexed ${docsWithEmbeddings.length} documents`);
    } catch (error) {
      console.error('❌ Failed to index documents:', error);
      throw error;
    }
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
    const addDocument = (doc: Document, downloadUrl: string): boolean => {
      if (fetchedUrls.has(downloadUrl)) {
        return false;
      }
      fetchedUrls.add(downloadUrl);
      documents.push(doc);
      return true;
    };

    // Helper to score document relevance by title match
    const scoreByTitleRelevance = (title: string, topics: string[]): number => {
      const titleLower = title.toLowerCase();
      let score = 0;
      for (const topic of topics) {
        // Check for topic words in title
        const topicWords = topic.toLowerCase().split(/\s+/);
        for (const word of topicWords) {
          if (word.length > 3 && titleLower.includes(word)) {
            score += 1;
          }
        }
      }
      return score;
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
        // Use structured metadata instead of embedding in title
        addDocument({
          title: result.doc.title,
          chunk: truncatedText,
          score: 1.0,
          docType: ref.docType,
          docNumber: result.doc.documentNumber
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
                  // Score by title relevance to topics
                  const titleScore = scoreByTitleRelevance(result.title, classification.topics || []);
                  candidates.push({ result, docType, score: 0.9 + (titleScore * 0.1) });
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
              const titleScore = scoreByTitleRelevance(result.title, classification.topics || []);
              candidates.push({ result, docType, score: 0.85 + (titleScore * 0.1) });
            }
          }
        } catch (error) {
          console.warn(`  ⚠️ DRS filtered search for ${docType} failed:`, error);
        }
      }
      
      // Deduplicate candidates by URL and sort by relevance score
      const uniqueCandidates = candidates.filter((c, i, arr) => 
        arr.findIndex(x => x.result.mainDocumentDownloadURL === c.result.mainDocumentDownloadURL) === i &&
        !fetchedUrls.has(c.result.mainDocumentDownloadURL!)
      ).sort((a, b) => b.score - a.score); // Sort by score descending
      
      console.log(`  📋 Found ${uniqueCandidates.length} unique candidates (sorted by relevance), checking cache...`);
      // Log top 5 candidates with scores
      for (const c of uniqueCandidates.slice(0, 5)) {
        console.log(`    📄 ${c.result.documentNumber}: "${c.result.title.substring(0, 50)}..." score=${c.score.toFixed(2)}`);
      }
      
      // CACHE-FIRST: Check which candidates are cached (fast parallel check)
      const cacheChecks = await Promise.all(
        uniqueCandidates.map(async c => ({
          ...c,
          isCached: await drsClient.isCached(c.docType, c.result.documentNumber)
        }))
      );
      
      // Sort again after adding cache info, maintaining relevance order within cached/uncached groups
      const cachedCandidates = cacheChecks.filter(c => c.isCached).sort((a, b) => b.score - a.score);
      const uncachedCandidates = cacheChecks.filter(c => !c.isCached).sort((a, b) => b.score - a.score);
      
      console.log(`  📦 Cache status: ${cachedCandidates.length} cached, ${uncachedCandidates.length} need download`);
      
      // Phase 1: Fetch ALL cached documents (fast, no limit)
      for (const c of cachedCandidates) {
        if (documents.length >= DRS_CONFIG.maxTotalDocuments) break;
        
        const fetched = await drsClient.fetchDocumentDirect(c.result, c.docType);
        if (fetched) {
          const maxChars = 30000;
          // Use structured metadata instead of embedding in title
          addDocument({
            title: fetched.doc.title,
            chunk: fetched.text.substring(0, maxChars),
            score: c.score,
            docType: c.docType,
            docNumber: c.result.documentNumber
          }, c.result.mainDocumentDownloadURL!);
          console.log(`  📦 Cache hit: ${c.docType} ${c.result.documentNumber}`);
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
          // Use structured metadata instead of embedding in title
          addDocument({
            title: fetched.doc.title,
            chunk: fetched.text.substring(0, maxChars),
            score: c.score,
            docType: c.docType,
            docNumber: c.result.documentNumber
          }, c.result.mainDocumentDownloadURL!);
          console.log(`  ⬇️ Downloaded: ${c.docType} ${c.result.documentNumber} (${freshDownloadCount}/${DRS_CONFIG.maxFreshDownloads})`);
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
              // Use structured metadata instead of embedding in title
              addDocument({
                title: result.doc.title,
                chunk: result.text.substring(0, maxChars),
                score: 0.9,
                docType: docType,
                docNumber: result.doc.documentNumber
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

COMPLETENESS REQUIREMENTS:
When listing requirements, limits, criteria, or specifications:
- If the provided documents contain both Part 23 AND Part 25 content for a topic, you have COMPLETE coverage for airplane airworthiness - present information from BOTH parts
- Part 23 (normal category) uses performance-based requirements in the 23.2xxx sections (e.g., § 23.2240 covers structural durability including bird strike)
- Part 25 (transport category) uses prescriptive requirements with specific values (e.g., § 25.631 specifies 8-pound bird at Vc)
- If you have relevant content from both parts, DO NOT say the answer is incomplete
- Only say "incomplete" if the user asks about a specific part/category and you don't have that part's content
- For injury criteria, performance limits, test conditions, or pass/fail thresholds, include all values from the source documents

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
