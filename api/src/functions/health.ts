import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function health(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
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

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: health
});
