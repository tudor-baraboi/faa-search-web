import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";

export async function listCache(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`Listing cache contents`);

  const connectionString = process.env.BLOB_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
  
  if (!connectionString || connectionString === 'UseDevelopmentStorage=true') {
    return {
      status: 200,
      jsonBody: {
        enabled: false,
        message: "No Azure Storage configured",
        hasBlobConnectionString: !!process.env.BLOB_STORAGE_CONNECTION_STRING,
        hasAzureWebJobsStorage: !!process.env.AzureWebJobsStorage
      }
    };
  }

  try {
    const blobService = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobService.getContainerClient('document-cache');
    
    // Check if container exists
    const exists = await containerClient.exists();
    if (!exists) {
      return {
        status: 200,
        jsonBody: {
          enabled: true,
          containerExists: false,
          documents: []
        }
      };
    }

    // List all blobs
    const documents: Array<{name: string, size: number, lastModified: string}> = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      documents.push({
        name: blob.name,
        size: blob.properties.contentLength || 0,
        lastModified: blob.properties.lastModified?.toISOString() || ''
      });
    }

    // Group by type
    const cfrDocs = documents.filter(d => d.name.startsWith('cfr/'));
    const drsDocs = documents.filter(d => d.name.startsWith('drs/'));
    const classifierDocs = documents.filter(d => d.name.startsWith('classifier/'));

    return {
      status: 200,
      jsonBody: {
        enabled: true,
        containerExists: true,
        totalDocuments: documents.length,
        totalSize: documents.reduce((sum, d) => sum + d.size, 0),
        byType: {
          cfr: cfrDocs.length,
          drs: drsDocs.length,
          classifier: classifierDocs.length
        },
        recentDocuments: documents.slice(-20).reverse()
      }
    };
  } catch (error) {
    context.error('Cache list failed:', error);
    return {
      status: 500,
      jsonBody: {
        error: error instanceof Error ? error.message : String(error),
        hasBlobConnectionString: !!process.env.BLOB_STORAGE_CONNECTION_STRING
      }
    };
  }
}

app.http("listCache", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: listCache
});
