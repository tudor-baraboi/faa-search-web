/**
 * Azure AI Search vector search client
 */

import {
  SearchClient,
  SearchIndexClient,
  AzureKeyCredential,
  SearchIndex,
  KnownVectorSearchAlgorithmKind,
  KnownVectorSearchAlgorithmMetric,
} from '@azure/search-documents';
import { generateEmbeddings, generateQueryEmbedding, EMBEDDING_DIMENSIONS } from './embeddings';

const getSearchConfig = () => ({
  endpoint: process.env.AZURE_SEARCH_ENDPOINT || '',
  key: process.env.AZURE_SEARCH_KEY || '',
  indexName: process.env.AZURE_SEARCH_INDEX || 'faa-documents'
});

// Document interface for the search index
export interface FADocument {
  id: string;                    // Unique document ID (e.g., "cfr-14-23-2240" or "ac-23-8b")
  documentType: string;          // Document type (e.g., "eCFR", "AC", "AD", "TSO")
  title: string;                 // Document title (clean, without metadata prefix)
  content: string;               // Full text content
  contentVector?: number[];      // Embedding vector (1024 dims for Cohere)
  cfrPart?: number;              // CFR part number (e.g., 23, 25)
  cfrSection?: string;           // CFR section (e.g., "2240")
  documentNumber?: string;       // AC/AD number (e.g., "23-8C", "25-28")
  effectiveDate?: string;        // ISO date string
  source?: string;               // Source URL or reference
  lastIndexed: Date | string;    // When indexed
  // Additional metadata for future queries
  revision?: string;             // Document revision (e.g., "A", "B", "C")
  changeNumber?: string;         // Change number (e.g., "CHG 1", "CHG 2")
  status?: string;               // Document status (e.g., "Current", "Cancelled")
}

// Search result with score
export interface SearchResult {
  document: FADocument;
  score: number;
  highlights?: string[];
}

let searchClient: SearchClient<FADocument> | null = null;
let indexClient: SearchIndexClient | null = null;
let lastConfig: { endpoint: string; indexName: string } | null = null;

/**
 * Get the search client (lazy initialization)
 */
function getSearchClient(): SearchClient<FADocument> {
  const config = getSearchConfig();
  
  // Reset clients if config changed
  if (lastConfig && (lastConfig.endpoint !== config.endpoint || lastConfig.indexName !== config.indexName)) {
    searchClient = null;
    indexClient = null;
  }
  lastConfig = { endpoint: config.endpoint, indexName: config.indexName };
  
  if (!searchClient) {
    if (!config.endpoint || !config.key) {
      throw new Error('Azure Search credentials not configured');
    }
    searchClient = new SearchClient<FADocument>(
      config.endpoint,
      config.indexName,
      new AzureKeyCredential(config.key)
    );
  }
  return searchClient;
}

/**
 * Get the index client (for index management)
 */
function getIndexClient(): SearchIndexClient {
  const config = getSearchConfig();
  if (!indexClient) {
    if (!config.endpoint || !config.key) {
      throw new Error('Azure Search credentials not configured');
    }
    indexClient = new SearchIndexClient(
      config.endpoint,
      new AzureKeyCredential(config.key)
    );
  }
  return indexClient;
}

/**
 * Create the search index if it doesn't exist
 */
export async function ensureIndexExists(): Promise<void> {
  const client = getIndexClient();
  const config = getSearchConfig();
  
  try {
    await client.getIndex(config.indexName);
    console.log(`Index '${config.indexName}' already exists`);
    return;
  } catch (error: unknown) {
    // Index doesn't exist, create it
    // Check for 404 status code or "not found" in the message
    const isNotFound = (error as { statusCode?: number }).statusCode === 404 ||
                       (error instanceof Error && error.message.toLowerCase().includes('not found'));
    if (isNotFound) {
      console.log(`Creating index '${config.indexName}'...`);
    } else {
      throw error;
    }
  }

  const indexDefinition: SearchIndex = {
    name: config.indexName,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      { name: 'documentType', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'title', type: 'Edm.String', searchable: true },
      { name: 'content', type: 'Edm.String', searchable: true },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: EMBEDDING_DIMENSIONS,
        vectorSearchProfileName: 'vector-profile',
      },
      { name: 'cfrPart', type: 'Edm.Int32', filterable: true, facetable: true },
      { name: 'cfrSection', type: 'Edm.String', filterable: true, searchable: true },
      { name: 'documentNumber', type: 'Edm.String', filterable: true, searchable: true },
      { name: 'effectiveDate', type: 'Edm.String', filterable: true, sortable: true },
      { name: 'source', type: 'Edm.String' },
      { name: 'lastIndexed', type: 'Edm.String', filterable: true, sortable: true },
      // Additional metadata fields
      { name: 'revision', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'changeNumber', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'status', type: 'Edm.String', filterable: true, facetable: true },
    ],
    vectorSearch: {
      algorithms: [
        {
          name: 'hnsw-algorithm',
          kind: KnownVectorSearchAlgorithmKind.Hnsw,
          parameters: {
            m: 4,
            efConstruction: 400,
            efSearch: 500,
            metric: KnownVectorSearchAlgorithmMetric.Cosine,
          },
        },
      ],
      profiles: [
        {
          name: 'vector-profile',
          algorithmConfigurationName: 'hnsw-algorithm',
        },
      ],
    },
  };

  await client.createIndex(indexDefinition);
  console.log(`Index '${config.indexName}' created successfully`);
}

/**
 * Vector search for similar documents
 */
export async function vectorSearch(
  query: string,
  options: {
    top?: number;
    filter?: string;
    documentTypes?: string[];
  } = {}
): Promise<SearchResult[]> {
  const client = getSearchClient();
  const { top = 10, filter, documentTypes } = options;

  // Generate query embedding
  const queryVector = await generateQueryEmbedding(query);

  // Build filter string
  let filterString = filter || '';
  if (documentTypes && documentTypes.length > 0) {
    const typeFilter = documentTypes.map(t => `documentType eq '${t}'`).join(' or ');
    filterString = filterString ? `(${filterString}) and (${typeFilter})` : typeFilter;
  }

  const searchResults = await client.search('*', {
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector',
          vector: queryVector,
          kNearestNeighborsCount: top,
          fields: ['contentVector'],
        },
      ],
    },
    filter: filterString || undefined,
    top,
    select: ['id', 'documentType', 'title', 'content', 'cfrPart', 'cfrSection', 'documentNumber', 'effectiveDate', 'source', 'lastIndexed'],
  });

  const results: SearchResult[] = [];
  for await (const result of searchResults.results) {
    results.push({
      document: result.document as FADocument,
      score: result.score ?? 0,
    });
  }

  return results;
}

/**
 * Hybrid search combining vector and keyword search
 */
export async function hybridSearch(
  query: string,
  options: {
    top?: number;
    filter?: string;
    documentTypes?: string[];
  } = {}
): Promise<SearchResult[]> {
  const client = getSearchClient();
  const { top = 10, filter, documentTypes } = options;

  // Generate query embedding
  const queryVector = await generateQueryEmbedding(query);

  // Build filter string
  let filterString = filter || '';
  if (documentTypes && documentTypes.length > 0) {
    const typeFilter = documentTypes.map(t => `documentType eq '${t}'`).join(' or ');
    filterString = filterString ? `(${filterString}) and (${typeFilter})` : typeFilter;
  }

  // Hybrid search: text search + vector search
  const searchResults = await client.search(query, {
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector',
          vector: queryVector,
          kNearestNeighborsCount: top,
          fields: ['contentVector'],
        },
      ],
    },
    filter: filterString || undefined,
    top,
    select: ['id', 'documentType', 'title', 'content', 'cfrPart', 'cfrSection', 'documentNumber', 'effectiveDate', 'source', 'lastIndexed'],
    queryType: 'simple',
    searchFields: ['title', 'content', 'cfrSection', 'documentNumber'],
  });

  const results: SearchResult[] = [];
  for await (const result of searchResults.results) {
    results.push({
      document: result.document as FADocument,
      score: result.score ?? 0,
    });
  }

  return results;
}

/**
 * Index a single document (with embedding generation)
 */
export async function indexDocument(doc: Omit<FADocument, 'contentVector' | 'lastIndexed'>): Promise<void> {
  // Ensure the index exists before trying to index documents
  await ensureIndexExists();
  
  const client = getSearchClient();

  // Generate embedding for the document content
  const [embedding] = await generateEmbeddings([`${doc.title}\n\n${doc.content}`]);

  const document: FADocument = {
    ...doc,
    contentVector: embedding,
    lastIndexed: new Date().toISOString(),
  };

  await client.uploadDocuments([document]);
  console.log(`Indexed document: ${doc.id}`);
}

/**
 * Index multiple documents in batch
 */
export async function indexDocuments(docs: Array<Omit<FADocument, 'contentVector' | 'lastIndexed'>>): Promise<void> {
  if (docs.length === 0) return;

  // Ensure the index exists before trying to index documents
  await ensureIndexExists();
  
  const client = getSearchClient();

  // Generate embeddings in batches of 16 (API limit)
  const BATCH_SIZE = 16;
  const documents: FADocument[] = [];

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    const texts = batch.map(doc => `${doc.title}\n\n${doc.content}`);
    const embeddings = await generateEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      documents.push({
        ...batch[j],
        contentVector: embeddings[j],
        lastIndexed: new Date().toISOString(),
      });
    }
  }

  // Upload in batches of 1000 (Azure Search limit)
  const UPLOAD_BATCH_SIZE = 1000;
  for (let i = 0; i < documents.length; i += UPLOAD_BATCH_SIZE) {
    const batch = documents.slice(i, i + UPLOAD_BATCH_SIZE);
    await client.uploadDocuments(batch);
    console.log(`Indexed ${Math.min(i + UPLOAD_BATCH_SIZE, documents.length)}/${documents.length} documents`);
  }
}

/**
 * Check if a document exists in the index
 */
export async function documentExists(id: string): Promise<boolean> {
  const client = getSearchClient();
  try {
    await client.getDocument(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a document from the index
 */
export async function deleteDocument(id: string): Promise<void> {
  const client = getSearchClient();
  await client.deleteDocuments('id', [id]);
}

/**
 * Get document count in the index
 */
export async function getDocumentCount(): Promise<number> {
  const client = getSearchClient();
  return await client.getDocumentsCount();
}

/**
 * Check if vector search is available
 */
export function hasVectorSearch(): boolean {
  const config = getSearchConfig();
  return !!(config.endpoint && config.key);
}

/**
 * Get all indexed document numbers for a specific document type
 * Used to find which documents are already indexed vs need to be fetched
 */
export async function getIndexedDocumentNumbers(
  documentType?: string,
  maxResults: number = 1000
): Promise<Set<string>> {
  if (!hasVectorSearch()) return new Set();
  
  try {
    const client = getSearchClient();
    
    // Build filter for document type if specified
    const filter = documentType ? `documentType eq '${documentType}'` : undefined;
    
    // Search for all docs, only retrieve documentNumber field
    const searchResults = await client.search('*', {
      filter,
      top: maxResults,
      select: ['documentNumber'],
      queryType: 'simple',
    });
    
    const docNumbers = new Set<string>();
    for await (const result of searchResults.results) {
      const doc = result.document as FADocument;
      if (doc.documentNumber) {
        // Normalize: "AC 23-8C" -> "23-8C"
        const normalized = doc.documentNumber.replace(/^(AC|AD|TSO|Order)\s*/i, '').trim();
        docNumbers.add(normalized.toUpperCase());
      }
    }
    
    return docNumbers;
  } catch (error) {
    // Index might not exist yet
    console.warn('⚠️ Could not query indexed documents:', error);
    return new Set();
  }
}
