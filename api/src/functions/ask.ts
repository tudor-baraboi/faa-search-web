import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AircraftCertificationRAG } from "../lib/ragPipeline";
import { AskQuestionRequest, AskQuestionResponse } from "../lib/types";

export async function ask(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`HTTP function processed request for url "${request.url}"`);

  try {
    // Parse request body
    const body = await request.text();

    if (!body) {
      return {
        status: 400,
        jsonBody: {
          error: "Request body is required",
          answer: "",
          sources: [],
          sourceCount: 0,
          context: ""
        }
      };
    }

    const requestData: AskQuestionRequest = JSON.parse(body);

    // Validate question
    if (!requestData.question || typeof requestData.question !== "string" || requestData.question.trim() === "") {
      return {
        status: 400,
        jsonBody: {
          error: "Question is required and must be a non-empty string",
          answer: "",
          sources: [],
          sourceCount: 0,
          context: ""
        }
      };
    }

    // Create RAG instance and process question
    const rag = new AircraftCertificationRAG();
    const result = await rag.askQuestion(requestData.question.trim());

    // Return successful response
    const response: AskQuestionResponse = {
      answer: result.answer,
      sources: result.sources,
      sourceCount: result.sourceCount,
      context: result.context,
      error: result.error,
      fallbackUsed: result.fallbackUsed
    };

    return {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      },
      jsonBody: response
    };
  } catch (error) {
    context.error("Error processing request:", error);

    return {
      status: 500,
      jsonBody: {
        error: `Internal server error: ${error instanceof Error ? error.message : String(error)}`,
        answer: "",
        sources: [],
        sourceCount: 0,
        context: ""
      }
    };
  }
}

app.http("ask", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: ask
});
