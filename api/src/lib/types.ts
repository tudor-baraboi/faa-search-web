// TypeScript type definitions for FAA Search API

// Azure Search document interface
export interface SearchDocument {
  chunk: string;
  title: string;
}

export interface Document {
  chunk: string;
  title: string;
  score?: number;
}

export interface RAGResponse {
  answer: string;
  sources: string[];
  sourceCount: number;
  context: string;
  error?: string;
  fallbackUsed?: boolean;  // True if DRS API was used instead of Azure Search
}

export interface AskQuestionRequest {
  question: string;
}

export interface AskQuestionResponse extends RAGResponse {}
