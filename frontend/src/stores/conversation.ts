import { createStore } from "solid-js/store";
import type { ConversationState, Message } from "../types";
import { storage } from "../services/storage";
import { api } from "../services/api";

// Initialize state from localStorage or use defaults
const initialState: ConversationState = storage.load() || {
  messages: [],
  isLoading: false,
  showContext: false,
  error: null
};

export const [conversationState, setConversationState] = createStore<ConversationState>(initialState);

// Helper to generate unique IDs
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Actions
export const conversationActions = {
  async askQuestion(question: string) {
    if (!question.trim()) return;

    // Set loading state
    setConversationState("isLoading", true);
    setConversationState("error", null);

    try {
      // Call API
      const response = await api.askQuestion(question);

      // Create message from response
      const message: Message = {
        id: generateId(),
        timestamp: Date.now(),
        question: question.trim(),
        answer: response.answer,
        sources: response.sources,
        sourceCount: response.sourceCount,
        context: response.context,
        error: response.error
      };

      // Add message to store
      setConversationState("messages", (messages) => [...messages, message]);

      // Persist to localStorage
      storage.save(conversationState);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setConversationState("error", errorMessage);
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
    storage.clear();
  },

  setError(error: string | null) {
    setConversationState("error", error);
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
