// TypeScript type definitions for FAA Search API

// Re-export from queryClassifier
export type { QueryClassification } from './queryClassifier';

// Re-export from ecfrClient
export type { ECFRSection, ECFRSearchResult } from './ecfrClient';

export interface Document {
  chunk: string;
  title: string;
  score?: number;
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

export interface RAGResponse {
  answer: string;
  sources: string[];
  sourceCount: number;
  context: string;
  error?: string;
  ecfrUsed?: boolean;         // True if eCFR API was used
  cfrSources?: CFRSource[];   // CFR sections used in response
  drsSources?: DRSSource[];   // DRS documents used in response
  classificationUsed?: boolean; // True if classifier was used
}

export interface AskQuestionRequest {
  question: string;
}

export interface AskQuestionResponse extends RAGResponse {}
