import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function testDrs(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`Testing DRS connectivity`);

  const apiKey = process.env.DRS_API_KEY || '';
  const baseURL = process.env.DRS_API_ENDPOINT || 'https://drs.faa.gov/api/drs';
  
  try {
    // Direct fetch test - bypass DRSClient
    const url = `${baseURL}/data-pull/AC/filtered`;
    context.log(`Fetching: ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        offset: 0,
        documentFilters: {
          'drs:status': ['Current'],
          'Keyword': ['23-8C']
        }
      })
    });
    
    const status = response.status;
    const statusText = response.statusText;
    const responseText = await response.text();
    
    let parsed = null;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      // Not JSON
    }
    
    return {
      status: 200,
      jsonBody: {
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey.length,
        apiKeyPrefix: apiKey.substring(0, 8) + '...',
        endpoint: baseURL,
        fetchStatus: status,
        fetchStatusText: statusText,
        responseLength: responseText.length,
        documentCount: parsed?.summary?.totalItems || 0,
        firstDocNumber: parsed?.documents?.[0]?.['drs:documentNumber'] || null,
        success: status === 200 && parsed?.documents?.length > 0
      }
    };
  } catch (error) {
    context.error('DRS test failed:', error);
    return {
      status: 500,
      jsonBody: {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey.length
      }
    };
  }
}

app.http("testDrs", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: testDrs
});
