import { createStore } from "solid-js/store";
import type { ConversationState, Message } from "../types";
import { storage } from "../services/storage";
import { api } from "../services/api";

// Initialize state from localStorage or use defaults
const initialState: ConversationState = storage.load() || {
  messages: [],
  isLoading: false,
  showContext: false,
  error: null,
  sessionId: null,
  rateLimitCountdown: null,
  pendingQuestion: null
};

// Rate limit countdown interval
let countdownInterval: ReturnType<typeof setInterval> | null = null;

// Start rate limit countdown (60 seconds)
function startRateLimitCountdown(question: string) {
  setConversationState("rateLimitCountdown", 60);
  setConversationState("pendingQuestion", question);
  setConversationState("error", null);
  
  if (countdownInterval) clearInterval(countdownInterval);
  
  countdownInterval = setInterval(() => {
    const current = conversationState.rateLimitCountdown;
    if (current !== null && current > 0) {
      setConversationState("rateLimitCountdown", current - 1);
    } else {
      // Countdown finished, retry the question
      if (countdownInterval) clearInterval(countdownInterval);
      countdownInterval = null;
      const pending = conversationState.pendingQuestion;
      setConversationState("rateLimitCountdown", null);
      setConversationState("pendingQuestion", null);
      if (pending) {
        conversationActions.askQuestion(pending);
      }
    }
  }, 1000);
}

// Check if error is a rate limit error
function isRateLimitError(error: string): boolean {
  return error.includes('429') || error.includes('rate_limit') || error.includes('rate limit');
}

export const [conversationState, setConversationState] = createStore<ConversationState>(initialState);

// Helper to generate unique IDs
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Check if the last message was a clarifying question
function isLastMessageClarifying(): boolean {
  const messages = conversationState.messages;
  if (messages.length === 0) return false;
  return messages[messages.length - 1].needsClarification === true;
}

// Actions
export const conversationActions = {
  async askQuestion(question: string) {
    if (!question.trim()) return;

    // Set loading state
    setConversationState("isLoading", true);
    setConversationState("error", null);

    try {
      // Determine if this is a response to a clarifying question
      const isClarifying = isLastMessageClarifying();
      
      // Call API with session ID for conversation continuity
      const response = await api.askQuestion(
        question,
        conversationState.sessionId || undefined,
        isClarifying
      );

      // Update session ID if returned (new session or existing)
      if (response.sessionId) {
        setConversationState("sessionId", response.sessionId);
      }

      // Create message from response
      const message: Message = {
        id: generateId(),
        timestamp: Date.now(),
        question: question.trim(),
        answer: response.answer,
        sources: response.sources,
        sourceCount: response.sourceCount,
        context: response.context,
        error: response.error,
        needsClarification: response.needsClarification,
        clarifyingQuestion: response.clarifyingQuestion
      };

      // Add message to store
      setConversationState("messages", (messages) => [...messages, message]);

      // Persist to localStorage
      storage.save(conversationState);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a rate limit error
      if (isRateLimitError(errorMessage)) {
        console.log("Rate limit hit, starting 60s countdown...");
        startRateLimitCountdown(question);
      } else {
        setConversationState("error", errorMessage);
      }
      console.error("Failed to get answer:", error);
    } finally {
      setConversationState("isLoading", false);
    }
  },

  toggleContextVisibility() {
    setConversationState("showContext", (show) => !show);
    // Persist setting
    storage.save(conversationState);
  },

  clearMessages() {
    setConversationState("messages", []);
    setConversationState("sessionId", null);  // Reset session on clear
    storage.clear();
  },

  setError(error: string | null) {
    setConversationState("error", error);
  },

  // Start a new conversation (clears session but keeps history visible)
  newConversation() {
    setConversationState("sessionId", null);
    // Optionally could add a separator in messages or just clear them
    // For now, just reset the session ID
  },

  exportConversation(format: "json" | "text") {
    const data = format === "json" ? storage.exportAsJSON() : storage.exportAsText();

    // Create download
    const blob = new Blob([data], { type: format === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faa-conversation-${new Date().toISOString().split('T')[0]}.${format === "json" ? "json" : "txt"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
