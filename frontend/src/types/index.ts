// Frontend TypeScript type definitions

export interface Message {
  id: string;
  timestamp: number;
  question: string;
  answer: string;
  sources: string[];
  sourceCount: number;
  context: string;
  error?: string;
  fallbackUsed?: boolean;  // True if DRS API was used instead of Azure Search
}

export interface ConversationState {
  messages: Message[];
  isLoading: boolean;
  showContext: boolean;
  error: string | null;
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
