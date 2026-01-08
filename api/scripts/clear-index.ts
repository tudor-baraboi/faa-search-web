/**
 * Script to clear the vector search index
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';

// Load local.settings.json
const settingsPath = join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
for (const [key, value] of Object.entries(settings.Values)) {
  if (typeof value === 'string') {
    process.env[key] = value;
  }
}

async function clearIndex() {
  const client = new SearchIndexClient(
    process.env.AZURE_SEARCH_ENDPOINT!,
    new AzureKeyCredential(process.env.AZURE_SEARCH_KEY!)
  );
  
  const indexName = process.env.AZURE_SEARCH_INDEX || 'faa-documents';
  
  try {
    await client.deleteIndex(indexName);
    console.log(`✅ Index '${indexName}' deleted`);
  } catch (e: any) {
    if (e.statusCode === 404) {
      console.log(`ℹ️ Index '${indexName}' does not exist`);
    } else {
      throw e;
    }
  }
}

clearIndex().catch(console.error);
