// Load polyfills first
import "./polyfills";

import { SearchClient } from "@azure/search-documents";
import Anthropic from "@anthropic-ai/sdk";
import { Document, RAGResponse, SearchDocument } from "./types";
import { createSearchClient } from "./azureSearch";
import { createAnthropicClient } from "./anthropic";
import { DRSClient } from "./drsClient";
import { evaluateSearchResults, extractDocumentType, SearchDocument as EvalSearchDocument } from "./searchEvaluator";

export class AircraftCertificationRAG {
  private searchClient: SearchClient<SearchDocument>;
  private anthropic: Anthropic;

  constructor() {
    this.searchClient = createSearchClient();
    this.anthropic = createAnthropicClient();
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
   * Main RAG pipeline: retrieve + generate answer
   * Enhanced with DRS fallback when Azure Search results are insufficient
   */
  async askQuestion(question: string): Promise<RAGResponse> {
    // Step 1: Retrieve relevant documents from Azure Search
    let documents: Document[];
    let searchError: string | undefined;
    let fallbackUsed = false;

    try {
      documents = await this.searchFAARegulations(question);
    } catch (error) {
      searchError = error instanceof Error ? error.message : String(error);
      console.error("Search failed with error:", searchError);
      documents = [];
    }

    // Step 2: Evaluate search quality and potentially fallback to DRS
    const evalDocs: EvalSearchDocument[] = documents.map(d => ({
      title: d.title,
      score: d.score,
      chunk: d.chunk
    }));

    const quality = evaluateSearchResults(evalDocs, question);
    console.log(`📊 Search quality: ${quality.reason} (score: ${quality.score.toFixed(2)})`);

    if (!quality.isSufficient) {
      console.log('🔄 Azure Search insufficient, attempting DRS fallback...');

      try {
        const drsResult = await this.fetchFromDRS(question, quality.specificDocMentioned);

        if (drsResult) {
          documents = drsResult.documents;
          fallbackUsed = true;
          console.log(`✅ DRS fallback successful: ${documents.length} document(s) retrieved`);
        }
      } catch (drsError) {
        console.error('❌ DRS fallback failed:', drsError);
        // Continue with whatever Azure Search results we have
      }
    }

    if (documents.length === 0) {
      return {
        answer: searchError
          ? `Search failed: ${searchError}`
          : "I couldn't find relevant information in the FAA regulations and guidance materials. The document may not be available in our index or the FAA DRS system.",
        sources: [],
        sourceCount: 0,
        context: "",
        error: searchError,
        fallbackUsed
      };
    }

    // Step 3: Format context
    const context = this.formatContext(documents);

    // Step 4: Create prompt for Claude
    const systemPrompt = this.buildSystemPrompt(fallbackUsed);

    const userMessage = `${context}

User Question: ${question}

Please answer based on the FAA regulations and guidance materials provided above.`;

    // Step 5: Call Claude
    console.log("🤖 Generating answer with Claude...");

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: "user", content: userMessage }
        ]
      });

      const answer = response.content[0].type === "text" ? response.content[0].text : "";

      // Step 6: Return answer with sources
      return {
        answer,
        sources: documents.map(doc => doc.title),
        sourceCount: documents.length,
        context,
        error: undefined,
        fallbackUsed
      };
    } catch (error) {
      console.error("Error generating answer:", error);
      return {
        answer: "",
        sources: [],
        sourceCount: 0,
        context: "",
        error: `Error generating answer: ${error instanceof Error ? error.message : String(error)}`,
        fallbackUsed
      };
    }
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
