import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { DRSClient } from "../lib/drsClient";

export async function testDrs(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`Testing DRS connectivity`);

  const drsClient = new DRSClient();
  
  try {
    // Test 1: Check if API key is set
    const hasKey = !!process.env.DRS_API_KEY;
    const keyLength = process.env.DRS_API_KEY?.length || 0;
    const endpoint = process.env.DRS_API_ENDPOINT || 'https://drs.faa.gov/api/drs (default)';
    
    // Test 2: Try to search for a known document
    context.log('Attempting DRS search for AC 23-8C...');
    const doc = await drsClient.searchByDocumentNumber('23-8C', 'AC');
    
    return {
      status: 200,
      jsonBody: {
        hasApiKey: hasKey,
        apiKeyLength: keyLength,
        endpoint: endpoint,
        searchResult: doc ? {
          documentNumber: doc.documentNumber,
          title: doc.title,
          hasDownloadUrl: !!doc.mainDocumentDownloadURL
        } : null,
        success: !!doc
      }
    };
  } catch (error) {
    context.error('DRS test failed:', error);
    return {
      status: 500,
      jsonBody: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        hasApiKey: !!process.env.DRS_API_KEY,
        apiKeyLength: process.env.DRS_API_KEY?.length || 0
      }
    };
  }
}

app.http("testDrs", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: testDrs
});
