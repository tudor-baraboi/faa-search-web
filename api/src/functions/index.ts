import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AircraftCertificationRAG } from "../lib/ragPipeline";
import { AskQuestionRequest, AskQuestionResponse } from "../lib/types";
import { getConversationStore, ConversationTurn } from "../lib/conversationStore";

// Ask endpoint - main RAG pipeline
app.http('ask', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'ask',
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        context.log(`HTTP function processed request for url "${request.url}"`);

        try {
            // Parse request body
            const body = await request.json() as AskQuestionRequest;

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

            // Validate question
            if (!body.question || typeof body.question !== "string" || body.question.trim() === "") {
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

            const question = body.question.trim();
            const conversationStore = getConversationStore();

            // Get or create session
            let sessionId = body.sessionId;
            if (!sessionId) {
                sessionId = conversationStore.generateSessionId();
                context.log(`New session created: ${sessionId}`);
            }

            // Load existing conversation if any
            const conversation = await conversationStore.get(sessionId);

            // Add user question to conversation
            const userTurn: ConversationTurn = {
                role: 'user',
                content: question,
                timestamp: Date.now()
            };

            // Create RAG instance and process question
            const rag = new AircraftCertificationRAG();
            const result = await rag.askQuestion(question, {
                sessionId,
                isClarifying: body.isClarifying || false,
                conversation
            });

            // Add assistant response to conversation
            const assistantTurn: ConversationTurn = {
                role: 'assistant',
                content: result.answer,
                timestamp: Date.now(),
                sources: result.sources,
                isClarifying: result.needsClarification || false
            };

            // Save conversation turns
            if (conversation) {
                conversation.turns.push(userTurn, assistantTurn);
                await conversationStore.save(conversation);
            } else {
                // Create new conversation with both turns
                await conversationStore.save({
                    sessionId,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    turns: [userTurn, assistantTurn]
                });
            }

            // Return successful response
            const response: AskQuestionResponse = {
                answer: result.answer,
                sources: result.sources,
                sourceCount: result.sourceCount,
                context: result.context,
                error: result.error,
                sessionId,
                needsClarification: result.needsClarification,
                clarifyingQuestion: result.clarifyingQuestion
            };

            return {
                status: 200,
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
});

// Health check endpoint
app.http('health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'health',
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        context.log(`Health check endpoint called`);

        const config = {
            hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
            hasDrsApiKey: !!process.env.DRS_API_KEY,
            hasBlobStorage: !!process.env.BLOB_STORAGE_CONNECTION_STRING,
            nodeVersion: process.version,
            platform: process.platform
        };

        return {
            status: 200,
            jsonBody: config
        };
    }
});
