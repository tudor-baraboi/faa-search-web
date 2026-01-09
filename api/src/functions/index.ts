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

// Reindex endpoint - clears index and re-queues all documents for chunked indexing
app.http('reindex', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'reindex',
    handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
        context.log(`Reindex endpoint called`);
        
        try {
            const { deleteAllDocuments, getIndexStats } = await import('../lib/vectorSearch');
            const { enqueueForIndexing, hasIndexQueue, getQueueStats } = await import('../lib/indexQueue');
            const { DRSClient } = await import('../lib/drsClient');
            const { getChunkConfig } = await import('../lib/chunker');
            
            // Parse options from request body
            const body = await request.json().catch(() => ({})) as { 
                clearIndex?: boolean;
                docTypes?: string[];
                limit?: number;
            };
            
            const clearIndex = body.clearIndex !== false; // Default true
            const docTypes = body.docTypes || ['AC']; // Default to ACs only
            const limit = body.limit || 50; // Default 50 docs
            
            // Check prerequisites
            if (!hasIndexQueue()) {
                return {
                    status: 500,
                    jsonBody: { error: 'Index queue not available. Check Azure Storage configuration.' }
                };
            }
            
            // Step 1: Clear existing index if requested
            let deletedCount = 0;
            if (clearIndex) {
                context.log('Clearing existing index...');
                deletedCount = await deleteAllDocuments();
                context.log(`Deleted ${deletedCount} documents from index`);
            }
            
            // Step 2: Search DRS for documents to reindex
            const drsClient = new DRSClient();
            const enqueuedDocs: string[] = [];
            
            for (const docType of docTypes) {
                context.log(`Searching DRS for ${docType} documents...`);
                
                // Search for common part numbers
                const partSearches = ['Part 23', 'Part 25', 'Part 27', 'Part 33', 'Part 35', 'Part 43'];
                const seenGuids = new Set<string>();
                
                for (const searchTerm of partSearches) {
                    if (enqueuedDocs.length >= limit) break;
                    
                    try {
                        const results = await drsClient.searchDocuments(searchTerm, docType);
                        
                        for (const doc of results.slice(0, 10)) {
                            if (enqueuedDocs.length >= limit) break;
                            if (seenGuids.has(doc.documentGuid)) continue;
                            seenGuids.add(doc.documentGuid);
                            
                            const enqueued = await enqueueForIndexing(doc, docType);
                            if (enqueued) {
                                enqueuedDocs.push(`${docType} ${doc.documentNumber}`);
                                context.log(`Enqueued: ${docType} ${doc.documentNumber}`);
                            }
                        }
                    } catch (err) {
                        context.warn(`Failed to search DRS for "${searchTerm}":`, err);
                    }
                }
            }
            
            // Get queue stats
            const queueStats = await getQueueStats();
            const chunkConfig = getChunkConfig();
            
            return {
                status: 200,
                jsonBody: {
                    success: true,
                    deletedFromIndex: deletedCount,
                    enqueuedForIndexing: enqueuedDocs.length,
                    documents: enqueuedDocs,
                    queueStats,
                    chunkConfig,
                    message: `Cleared ${deletedCount} docs, enqueued ${enqueuedDocs.length} for chunked reindexing`
                }
            };
            
        } catch (error) {
            context.error('Reindex error:', error);
            return {
                status: 500,
                jsonBody: { 
                    error: error instanceof Error ? error.message : String(error) 
                }
            };
        }
    }
});
