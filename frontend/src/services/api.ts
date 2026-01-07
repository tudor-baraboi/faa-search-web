import type { RAGResponse, AskQuestionRequest } from "../types";

class FAASearchAPI {
  private baseURL = "/api";

  async askQuestion(question: string, sessionId?: string, isClarifying?: boolean): Promise<RAGResponse> {
    try {
      const request: AskQuestionRequest = { 
        question,
        sessionId,
        isClarifying
      };

      const response = await fetch(`${this.baseURL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || `API error: ${response.statusText}`);
      }

      const data: RAGResponse = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

export const api = new FAASearchAPI();
