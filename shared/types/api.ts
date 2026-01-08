/**
 * Shared type definitions for FAA Search API
 * Used by both API and frontend packages
 */

/**
 * Document with optional metadata fields for structured querying
 */
export interface Document {
  chunk: string;
  title: string;
  score?: number;
  // Structured metadata (avoids embedding in title)
  docType?: string;         // e.g., "AC", "AD", "TSO", "eCFR"
  docNumber?: string;       // e.g., "23-8C", "25-28"
  cfrPart?: number;         // e.g., 23, 25
  cfrSection?: string;      // e.g., "2150", "1309"
  // Additional metadata for future use
  revision?: string;        // e.g., "A", "B", "C"
  changeNumber?: string;    // e.g., "CHG 1", "CHG 2"
  status?: string;          // e.g., "Current", "Cancelled"
}

/**
 * CFR Source info in RAG response
 */
export interface CFRSource {
  title: number;         // e.g., 14
  part: number;          // e.g., 23
  section: string;       // e.g., "2150"
  sectionTitle: string;  // e.g., "Stall speed"
  url: string;           // Direct link to eCFR
}

/**
 * DRS Source info in RAG response
 */
export interface DRSSource {
  docType: string;       // e.g., "AC", "AD", "TSO"
  docNumber: string;     // e.g., "23-8C"
  title: string;
  url?: string;
}

/**
 * RAG API response
 */
export interface RAGResponse {
  answer: string;
  sources: string[];
  sourceCount: number;
  context: string;
  error?: string;
  ecfrUsed?: boolean;           // True if eCFR API was used
  cfrSources?: CFRSource[];     // CFR sections used in response
  drsSources?: DRSSource[];     // DRS documents used in response
  classificationUsed?: boolean; // True if classifier was used
  vectorSearchUsed?: boolean;   // True if vector search was used
  // Multi-turn conversation fields
  sessionId?: string;           // Session ID for conversation continuity
  needsClarification?: boolean; // True if the query was too vague/broad
  clarifyingQuestion?: string;  // Follow-up question to ask the user
}

/**
 * Request to ask a question
 */
export interface AskQuestionRequest {
  question: string;
  sessionId?: string;         // Optional session ID for conversation continuity
  isClarifying?: boolean;     // True if this is a response to a clarifying question
}

/**
 * Response from ask question endpoint
 */
export interface AskQuestionResponse extends RAGResponse {}
