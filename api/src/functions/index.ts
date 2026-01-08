import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AircraftCertificationRAG } from "../lib/ragPipeline";
import { AskQuestionRequest, AskQuestionResponse } from "../lib/types";
import { getConversationStore, ConversationTurn } from "../lib/conversationStore";
import { processQueueMessage, decodeQueueMessage, IndexQueueMessage } from "../lib/indexQueue";

// Index Worker - Queue-triggered function for background document indexing
app.storageQueue('indexWorker', {
    queueName: process.env.INDEX_QUEUE_NAME || 'index-queue',
    connection: 'AzureWebJobsStorage',
    handler: async (message: unknown, context: InvocationContext): Promise<void> => {
        context.log(`📥 Index worker received message`);
        
        try {
            // Decode the message (Azure Storage Queue sends base64 encoded)
            let queueMessage: IndexQueueMessage;
            
            if (typeof message === 'string') {
                // Message might be base64 encoded or raw JSON
                try {
                    queueMessage = decodeQueueMessage(message);
                } catch {
                    // Try parsing as raw JSON
                    queueMessage = JSON.parse(message);
                }
            } else {
                queueMessage = message as IndexQueueMessage;
            }
            
            context.log(`⏳ Processing: ${queueMessage.docType} ${queueMessage.documentNumber}`);
            
            const success = await processQueueMessage(queueMessage);
            
            if (success) {
                context.log(`✅ Successfully indexed: ${queueMessage.docType} ${queueMessage.documentNumber}`);
            } else {
                // Throwing will trigger retry/poison queue behavior
                throw new Error(`Failed to process: ${queueMessage.docType} ${queueMessage.documentNumber}`);
            }
        } catch (error) {
            context.error('❌ Index worker error:', error);
            // Re-throw to trigger Azure Functions retry behavior
            throw error;
        }
    }
});

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
                clarifyingQuestion: result.clarifyingQuestion,
                ecfrUsed: result.ecfrUsed,
                cfrSources: result.cfrSources,
                drsSources: result.drsSources,
                classificationUsed: result.classificationUsed,
                vectorSearchUsed: result.vectorSearchUsed
            };

            return {
                status: 200,
                jsonBody: response
            };
        } catch (error) {
            context.error("Error processing request:", error);
            
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Check if it's a rate limit error (429)
            const isRateLimitError = errorMessage.includes('429') || 
                                     errorMessage.includes('rate_limit') || 
                                     errorMessage.includes('rate limit');

            return {
                status: isRateLimitError ? 429 : 500,
                jsonBody: {
                    error: isRateLimitError 
                        ? "Rate limit exceeded. Please wait a moment before trying again."
                        : `Internal server error: ${errorMessage}`,
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
        
        // Import vector search functions
        const { hasVectorSearch } = await import('../lib/vectorSearch');
        const { hasEmbeddingService } = await import('../lib/embeddings');
        const { getQueueStats, hasIndexQueue } = await import('../lib/indexQueue');

        // Get queue statistics if available
        let indexQueue = null;
        if (hasIndexQueue()) {
            try {
                indexQueue = await getQueueStats();
            } catch (err) {
                context.warn('Failed to get queue stats:', err);
            }
        }

        const config = {
            hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
            hasDrsApiKey: !!process.env.DRS_API_KEY,
            hasBlobStorage: !!process.env.BLOB_STORAGE_CONNECTION_STRING,
            hasVectorSearch: hasVectorSearch(),
            hasEmbeddingService: hasEmbeddingService(),
            hasIndexQueue: hasIndexQueue(),
            indexQueue,
            nodeVersion: process.version,
            platform: process.platform
        };

        return {
            status: 200,
            jsonBody: config
        };
    }
});
