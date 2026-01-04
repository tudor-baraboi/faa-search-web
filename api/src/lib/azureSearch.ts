import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { SearchDocument } from "./types";

export function createSearchClient(): SearchClient<SearchDocument> {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const key = process.env.AZURE_SEARCH_KEY;
  const indexName = process.env.AZURE_SEARCH_INDEX;

  if (!endpoint || !key || !indexName) {
    throw new Error(
      "Missing Azure Search configuration. Please set AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY, and AZURE_SEARCH_INDEX environment variables."
    );
  }

  return new SearchClient(endpoint, indexName, new AzureKeyCredential(key));
}
