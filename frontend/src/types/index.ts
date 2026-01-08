// Frontend TypeScript type definitions

// Re-export shared types (single source of truth)
export type { 
  Document,
  CFRSource, 
  DRSSource, 
  RAGResponse, 
  AskQuestionRequest, 
  AskQuestionResponse 
} from '@shared/types/api';

// Frontend-only types (UI state)

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
  rateLimitCountdown: number | null;  // Seconds until rate limit resets
  pendingQuestion: string | null;  // Question to retry after rate limit
}
