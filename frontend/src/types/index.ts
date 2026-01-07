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
  needsClarification?: boolean;  // True if the assistant is asking a clarifying question
  clarifyingQuestion?: string;   // The clarifying question text
}

export interface ConversationState {
  messages: Message[];
  isLoading: boolean;
  showContext: boolean;
  error: string | null;
  sessionId: string | null;  // Session ID for multi-turn conversations
}

export interface RAGResponse {
  answer: string;
  sources: string[];
  sourceCount: number;
  context: string;
  error?: string;
  sessionId?: string;            // Session ID returned from API
  needsClarification?: boolean;  // True if the assistant is asking a clarifying question
  clarifyingQuestion?: string;   // The clarifying question text
}

export interface AskQuestionRequest {
  question: string;
  sessionId?: string;     // Session ID for conversation continuity
  isClarifying?: boolean; // True if this is a response to a clarifying question
}
