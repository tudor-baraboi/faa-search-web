import { app, InvocationContext } from "@azure/functions";
import { processQueueMessage, decodeQueueMessage, IndexQueueMessage } from "../lib/indexQueue";

/**
 * Queue-triggered function that processes background indexing jobs.
 * 
 * This function:
 * 1. Receives messages from the 'index-queue' Azure Storage Queue
 * 2. Downloads the PDF from the URL in the message
 * 3. Extracts text and generates embeddings
 * 4. Indexes the document in Azure AI Search
 * 
 * Failed messages are automatically retried (up to maxDequeueCount times)
 * and then moved to the poison queue.
 */
async function indexWorkerHandler(
  queueItem: unknown,
  context: InvocationContext
): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Parse the queue message (base64 encoded JSON)
    let message: IndexQueueMessage;
    
    if (typeof queueItem === 'string') {
      // Base64 encoded message from Azure Storage Queue
      message = decodeQueueMessage(queueItem);
    } else {
      // Already parsed (shouldn't happen but handle it)
      message = queueItem as IndexQueueMessage;
    }
    
    if (!message || !message.documentGuid || !message.downloadUrl) {
      context.error("Invalid queue message format", { message: queueItem });
      // Don't throw - invalid messages should be discarded, not retried
      return;
    }

    context.log(`Processing index job for document: ${message.documentGuid}`);
    context.log(`Document: ${message.docType} ${message.documentNumber}`);
    context.log(`Attempt: ${context.triggerMetadata?.dequeueCount || 1}`);

    // Process the document (download, extract, embed, index)
    const success = await processQueueMessage(message);

    const duration = Date.now() - startTime;

    if (success) {
      context.log(`Successfully processed ${message.docType} ${message.documentNumber} (${duration}ms)`);
    } else {
      // Log error and throw to trigger retry
      context.error(`Failed to index document ${message.documentNumber}`);
      throw new Error(`Failed to index ${message.docType} ${message.documentNumber}`);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    context.error(`Index worker error after ${duration}ms:`, error);
    
    // Re-throw to trigger retry mechanism
    // After maxDequeueCount failures, message goes to poison queue
    throw error;
  }
}

// Register the queue-triggered function
app.storageQueue("indexWorker", {
  queueName: "index-queue",
  connection: "AzureWebJobsStorage",
  handler: indexWorkerHandler,
});
