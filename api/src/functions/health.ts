import { Context, HttpRequest } from "@azure/functions";

const health = async function (context: Context, req: HttpRequest): Promise<void> {
  context.log(`Health check endpoint called`);

  const config = {
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasDrsApiKey: !!process.env.DRS_API_KEY,
    hasBlobStorage: !!process.env.BLOB_STORAGE_CONNECTION_STRING,
    nodeVersion: process.version,
    platform: process.platform
  };

  context.res = {
    status: 200,
    body: JSON.stringify(config),
    headers: { "Content-Type": "application/json" }
  };
};

export default health;
