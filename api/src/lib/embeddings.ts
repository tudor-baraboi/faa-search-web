/**
 * Embedding client using Azure AI Services with Cohere model
 * Uses the Azure AI Model Inference API for Cohere models
 */

const getConfig = () => ({
  endpoint: process.env.AZURE_AI_SERVICES_ENDPOINT || '',
  key: process.env.AZURE_AI_SERVICES_KEY || '',
  deploymentName: 'cohere-embed'
});

// Cohere embed-v3-english produces 1024-dimensional vectors
export const EMBEDDING_DIMENSIONS = 1024;

// Azure AI Model Inference API response format
interface ModelInferenceEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate embeddings for one or more texts using Azure AI Model Inference API
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const config = getConfig();
  if (!config.endpoint || !config.key) {
    throw new Error('Azure AI Services credentials not configured');
  }

  if (texts.length === 0) {
    return [];
  }

  // Use Azure AI Model Inference API format for Cohere
  // Format: {endpoint}/models/{deployment}/embeddings?api-version=2024-05-01-preview
  const url = `${config.endpoint}/models/embeddings?api-version=2024-05-01-preview`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.key}`,
      'extra-parameters': 'pass-through',
    },
    body: JSON.stringify({
      input: texts,
      model: config.deploymentName,
      // Cohere input_type: 'document' for documents, 'query' for search queries
      input_type: 'document',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as ModelInferenceEmbeddingResponse;
  
  // Sort by index to ensure correct order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(item => item.embedding);
}

/**
 * Generate embedding for a single text (query)
 */
export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const config = getConfig();
  if (!config.endpoint || !config.key) {
    throw new Error('Azure AI Services credentials not configured');
  }

  const url = `${config.endpoint}/models/embeddings?api-version=2024-05-01-preview`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.key}`,
      'extra-parameters': 'pass-through',
    },
    body: JSON.stringify({
      input: [text],
      model: config.deploymentName,
      // Use 'query' for search query embeddings
      input_type: 'query',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as ModelInferenceEmbeddingResponse;
  return data.data[0].embedding;
}

/**
 * Check if embedding service is available
 */
export function hasEmbeddingService(): boolean {
  const config = getConfig();
  return !!(config.endpoint && config.key);
}
