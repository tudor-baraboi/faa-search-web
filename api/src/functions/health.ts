import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function health(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  context.log(`Health check endpoint called`);

  const config = {
    hasAzureSearchEndpoint: !!process.env.AZURE_SEARCH_ENDPOINT,
    hasAzureSearchKey: !!process.env.AZURE_SEARCH_KEY,
    hasAzureSearchIndex: !!process.env.AZURE_SEARCH_INDEX,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasDrsApiKey: !!process.env.DRS_API_KEY,
    azureSearchEndpoint: process.env.AZURE_SEARCH_ENDPOINT || "NOT_SET",
    azureSearchIndex: process.env.AZURE_SEARCH_INDEX || "NOT_SET",
    nodeVersion: process.version,
    platform: process.platform
  };

  return {
    status: 200,
    jsonBody: config
  };
}

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: health
});
