/**
 * Index Queue - Azure Storage Queue for lazy background indexing
 * 
 * Decouples PDF download/indexing from the request path:
 * - Request path: DRS metadata check → enqueue unindexed docs → return
 * - Background: Queue worker downloads PDFs, generates embeddings, indexes
 */

import { QueueServiceClient, QueueClient } from "@azure/storage-queue";
import { DRSDocument } from "./drsClient";

/**
 * Queue message format for documents to index
 */
export interface IndexQueueMessage {
  documentGuid: string;
  documentNumber: string;
  title: string;
  docType: string;
  downloadUrl: string;
  enqueuedAt: string;
  retryCount?: number;
}

/**
 * Queue statistics for health endpoint
 */
export interface QueueStats {
  enabled: boolean;
  approximateMessageCount: number | null;
  queueName: string;
}

const QUEUE_CONFIG = {
  queueName: process.env.INDEX_QUEUE_NAME || 'index-queue',
  visibilityTimeout: 300,  // 5 minutes to process a message
  maxDequeueCount: 3,      // Move to poison queue after 3 failures
};

let queueClient: QueueClient | null = null;
let queueEnabled: boolean = true;
let initPromise: Promise<void> | null = null;

/**
 * Get the connection string for Azure Storage
 * In Azure Functions: AzureWebJobsStorage is the standard
 * For custom blob storage: BLOB_STORAGE_CONNECTION_STRING
 */
function getConnectionString(): string | null {
  return process.env.AzureWebJobsStorage || process.env.BLOB_STORAGE_CONNECTION_STRING || null;
}

/**
 * Initialize the queue client (creates queue if not exists)
 */
async function ensureQueueInitialized(): Promise<QueueClient | null> {
  if (!queueEnabled) return null;
  if (queueClient) return queueClient;
  
  if (initPromise) {
    await initPromise;
    return queueClient;
  }
  
  initPromise = (async () => {
    try {
      const connectionString = getConnectionString();
      if (!connectionString) {
        console.warn('⚠️  IndexQueue: No Azure Storage configured, queue disabled');
        queueEnabled = false;
        return;
      }
      
      const queueService = QueueServiceClient.fromConnectionString(connectionString);
      queueClient = queueService.getQueueClient(QUEUE_CONFIG.queueName);
      
      // Create queue if it doesn't exist
      await queueClient.createIfNotExists();
      console.log(`✅ IndexQueue initialized: ${QUEUE_CONFIG.queueName}`);
    } catch (error) {
      console.error('❌ IndexQueue initialization failed:', error);
      queueEnabled = false;
    }
  })();
  
  await initPromise;
  return queueClient;
}

/**
 * Check if queue indexing is enabled
 */
export function hasIndexQueue(): boolean {
  return queueEnabled && !!getConnectionString();
}

/**
 * Enqueue documents for background indexing
 * 
 * @param documents - Array of DRS documents with metadata
 * @returns Number of documents successfully enqueued
 */
export async function enqueueForIndexing(
  documents: { doc: DRSDocument; docType: string }[]
): Promise<number> {
  const client = await ensureQueueInitialized();
  if (!client) {
    console.warn('⚠️  IndexQueue not available, skipping enqueue');
    return 0;
  }
  
  let enqueuedCount = 0;
  const now = new Date().toISOString();
  
  for (const { doc, docType } of documents) {
    if (!doc.mainDocumentDownloadURL) {
      console.log(`  ⏭️ Skipping ${docType} ${doc.documentNumber}: no download URL`);
      continue;
    }
    
    const message: IndexQueueMessage = {
      documentGuid: doc.documentGuid,
      documentNumber: doc.documentNumber,
      title: doc.title,
      docType: docType,
      downloadUrl: doc.mainDocumentDownloadURL,
      enqueuedAt: now,
      retryCount: 0,
    };
    
    try {
      // Base64 encode the message (Azure Storage Queue requirement)
      const messageText = Buffer.from(JSON.stringify(message)).toString('base64');
      await client.sendMessage(messageText);
      enqueuedCount++;
      console.log(`  📬 Enqueued: ${docType} ${doc.documentNumber}`);
    } catch (error) {
      console.warn(`  ⚠️ Failed to enqueue ${docType} ${doc.documentNumber}:`, error);
    }
  }
  
  console.log(`📬 Enqueued ${enqueuedCount}/${documents.length} documents for background indexing`);
  return enqueuedCount;
}

/**
 * Get queue statistics for health/monitoring
 */
export async function getQueueStats(): Promise<QueueStats> {
  if (!hasIndexQueue()) {
    return {
      enabled: false,
      approximateMessageCount: null,
      queueName: QUEUE_CONFIG.queueName,
    };
  }
  
  try {
    const client = await ensureQueueInitialized();
    if (!client) {
      return {
        enabled: false,
        approximateMessageCount: null,
        queueName: QUEUE_CONFIG.queueName,
      };
    }
    
    const properties = await client.getProperties();
    return {
      enabled: true,
      approximateMessageCount: properties.approximateMessagesCount ?? 0,
      queueName: QUEUE_CONFIG.queueName,
    };
  } catch (error) {
    console.warn('⚠️ Failed to get queue stats:', error);
    return {
      enabled: queueEnabled,
      approximateMessageCount: null,
      queueName: QUEUE_CONFIG.queueName,
    };
  }
}

/**
 * Process a single queue message (called by queue trigger function)
 * Downloads PDF, extracts text, and indexes to vector store
 * 
 * @param message - The queue message to process
 * @returns true if processed successfully, false otherwise
 */
export async function processQueueMessage(message: IndexQueueMessage): Promise<boolean> {
  const { DRSClient } = await import('./drsClient');
  const { indexDocument, getIndexedDocumentNumbers } = await import('./vectorSearch');
  const { hasEmbeddingService } = await import('./embeddings');
  
  const startTime = Date.now();
  console.log(`⏳ Processing: ${message.docType} ${message.documentNumber}`);
  
  try {
    // 1. Deduplication check - is it already indexed?
    const indexedDocNumbers = await getIndexedDocumentNumbers();
    const normalizedNumber = message.documentNumber.replace(/^(AC|AD|TSO|Order)\s*/i, '').trim().toUpperCase();
    
    if (indexedDocNumbers.has(normalizedNumber)) {
      console.log(`  ⏭️ Already indexed: ${message.docType} ${message.documentNumber}`);
      return true; // Not an error, just skip
    }
    
    // 2. Check if we can index (embedding service available)
    if (!hasEmbeddingService()) {
      console.warn(`  ⚠️ Embedding service not available, cannot index`);
      return false;
    }
    
    // 3. Download and extract text
    const drsClient = new DRSClient();
    const drsDoc: DRSDocument = {
      documentGuid: message.documentGuid,
      documentNumber: message.documentNumber,
      title: message.title,
      docLastModifiedDate: message.enqueuedAt,
      mainDocumentDownloadURL: message.downloadUrl,
    };
    
    const result = await drsClient.fetchDocumentDirect(drsDoc, message.docType);
    if (!result) {
      console.warn(`  ❌ Failed to download: ${message.docType} ${message.documentNumber}`);
      return false;
    }
    
    // 4. Prepare document for indexing
    const maxChars = 50000;
    const truncatedText = result.text.length > maxChars
      ? result.text.substring(0, maxChars) + "\n\n[Document truncated due to length...]"
      : result.text;
    
    const docId = `drs-${message.docType.toLowerCase()}-${message.documentNumber.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    const docToIndex = {
      id: docId,
      documentType: message.docType,
      documentNumber: message.documentNumber,
      title: message.title,
      content: truncatedText,
      source: 'FAA DRS',
    };
    
    // 5. Index the document (embedding generated internally)
    await indexDocument(docToIndex);
    
    const elapsed = Date.now() - startTime;
    console.log(`  ✅ Indexed: ${message.docType} ${message.documentNumber} (${elapsed}ms)`);
    return true;
    
  } catch (error) {
    console.error(`  ❌ Error processing ${message.docType} ${message.documentNumber}:`, error);
    return false;
  }
}

/**
 * Decode a base64 queue message
 */
export function decodeQueueMessage(base64Message: string): IndexQueueMessage {
  const decoded = Buffer.from(base64Message, 'base64').toString('utf-8');
  return JSON.parse(decoded) as IndexQueueMessage;
}
