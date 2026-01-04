import type { Message, ConversationState } from "../types";

const STORAGE_KEY = "faa-conversation-history";
const MAX_MESSAGES = 50;

interface StoredData {
  version: string;
  lastUpdated: string;
  settings: {
    showContext: boolean;
  };
  messages: Message[];
}

export class ConversationStorage {
  load(): ConversationState | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const data: StoredData = JSON.parse(stored);
      return {
        messages: data.messages || [],
        isLoading: false,
        showContext: data.settings?.showContext || false,
        error: null
      };
    } catch (error) {
      console.error("Error loading conversation from localStorage:", error);
      return null;
    }
  }

  save(state: ConversationState): void {
    try {
      // Auto-prune to max messages
      const messages = state.messages.slice(-MAX_MESSAGES);

      const data: StoredData = {
        version: "1.0",
        lastUpdated: new Date().toISOString(),
        settings: {
          showContext: state.showContext
        },
        messages
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Error saving conversation to localStorage:", error);
      // Handle quota exceeded error
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        console.warn("LocalStorage quota exceeded. Clearing old messages...");
        // Try saving with fewer messages
        const data: StoredData = {
          version: "1.0",
          lastUpdated: new Date().toISOString(),
          settings: {
            showContext: state.showContext
          },
          messages: state.messages.slice(-10) // Keep only last 10
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("Error clearing localStorage:", error);
    }
  }

  exportAsJSON(): string {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || "{}";
  }

  exportAsText(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return "";

      const data: StoredData = JSON.parse(stored);
      let text = "FAA AIRCRAFT CERTIFICATION Q&A SESSION\\n";
      text += "=".repeat(80) + "\\n";
      text += `Exported: ${new Date().toISOString()}\\n`;
      text += "=".repeat(80) + "\\n\\n";

      for (const msg of data.messages) {
        const date = new Date(msg.timestamp).toLocaleString();
        text += `[${date}] QUESTION:\\n${msg.question}\\n\\n`;
        text += `[${date}] ANSWER:\\n${msg.answer}\\n\\n`;
        text += `SOURCES (${msg.sourceCount}):\\n`;
        for (const source of msg.sources) {
          text += `  • ${source}\\n`;
        }
        text += "\\n" + "-".repeat(80) + "\\n\\n";
      }

      return text;
    } catch (error) {
      console.error("Error exporting as text:", error);
      return "";
    }
  }
}

export const storage = new ConversationStorage();
