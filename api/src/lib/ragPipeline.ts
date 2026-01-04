import { SearchClient } from "@azure/search-documents";
import Anthropic from "@anthropic-ai/sdk";
import { Document, RAGResponse, SearchDocument } from "./types";
import { createSearchClient } from "./azureSearch";
import { createAnthropicClient } from "./anthropic";

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
      return [];
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
   * Ported from Python: faa-search.py lines 135-210
   */
  async askQuestion(question: string): Promise<RAGResponse> {
    // Step 1: Retrieve relevant documents
    const documents = await this.searchFAARegulations(question);

    if (documents.length === 0) {
      return {
        answer: "I couldn't find relevant information in the FAA regulations and guidance materials.",
        sources: [],
        sourceCount: 0,
        context: "",
        error: undefined
      };
    }

    // Step 2: Format context
    const context = this.formatContext(documents);

    // Step 3: Create prompt for Claude
    // CRITICAL: This system prompt is copied EXACTLY from Python (lines 158-175)
    const systemPrompt = `You are an FAA aircraft certification expert with deep knowledge of aviation regulations and guidance materials.

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

    const userMessage = `${context}

User Question: ${question}

Please answer based on the FAA regulations and guidance materials provided above.`;

    // Step 4: Call Claude
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

      // Step 5: Return answer with sources
      return {
        answer,
        sources: documents.map(doc => doc.title),
        sourceCount: documents.length,
        context,
        error: undefined
      };
    } catch (error) {
      console.error("Error generating answer:", error);
      return {
        answer: "",
        sources: [],
        sourceCount: 0,
        context: "",
        error: `Error generating answer: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
