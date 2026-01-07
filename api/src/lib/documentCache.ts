/**
 * Document Cache
 * Blob Storage-based caching for eCFR sections, DRS documents, and classifier results
 */

import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { createHash } from "crypto";

/**
 * Cached document wrapper
 */
export interface CachedDocument<T> {
  data: T;
  cachedAt: Date;
  ttlHours: number;
}

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
  containerName: 'document-cache',
  defaultTTLHours: 24,
  cfrTTLHours: 168,        // 7 days for CFR sections (rarely change)
  drsTTLHours: 24,         // 24 hours for DRS documents
  classifierTTLHours: 1,   // 1 hour for classifier results
};

/**
 * Document Cache using Azure Blob Storage
 * Uses the existing AzureWebJobsStorage connection string
 */
export class DocumentCache {
  private containerClient: ContainerClient | null = null;
  private initPromise: Promise<void> | null = null;
  private enabled: boolean = true;
  
  constructor() {
    // Check if storage is configured
    const connectionString = process.env.AzureWebJobsStorage;
    if (!connectionString || connectionString === 'UseDevelopmentStorage=true') {
      console.warn('⚠️  DocumentCache: No Azure Storage configured, caching disabled');
      this.enabled = false;
    }
  }
  
  /**
   * Initialize the container (creates if not exists)
   */
  private async initialize(): Promise<void> {
    if (!this.enabled) return;
    
    if (this.containerClient) return;
    
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    
    this.initPromise = (async () => {
      try {
        const connectionString = process.env.AzureWebJobsStorage!;
        const blobService = BlobServiceClient.fromConnectionString(connectionString);
        this.containerClient = blobService.getContainerClient(CACHE_CONFIG.containerName);
        
        // Create container if it doesn't exist
        await this.containerClient.createIfNotExists();
        console.log(`✅ DocumentCache initialized: ${CACHE_CONFIG.containerName}`);
      } catch (error) {
        console.error('❌ DocumentCache initialization failed:', error);
        this.enabled = false;
      }
    })();
    
    await this.initPromise;
  }
  
  /**
   * Get cached document
   * 
   * @param key - Cache key (e.g., "cfr/14/23/2150.json")
   * @returns Cached data or null if not found/expired
   */
  async get<T>(key: string): Promise<CachedDocument<T> | null> {
    if (!this.enabled) return null;
    
    try {
      await this.initialize();
      if (!this.containerClient) return null;
      
      const blobClient = this.containerClient.getBlobClient(key);
      
      // Check if blob exists and get properties
      const exists = await blobClient.exists();
      if (!exists) {
        return null;
      }
      
      const props = await blobClient.getProperties();
      
      // Check TTL based on metadata
      const cachedAtStr = props.metadata?.cachedat;
      const cachedAt = cachedAtStr ? new Date(cachedAtStr) : props.lastModified || new Date();
      const ttlHours = parseInt(props.metadata?.ttlhours || String(CACHE_CONFIG.defaultTTLHours));
      
      // Check if expired
      const ageMs = Date.now() - cachedAt.getTime();
      const ttlMs = ttlHours * 3600000;
      
      if (ageMs > ttlMs) {
        console.log(`📦 Cache expired: ${key} (age: ${Math.round(ageMs / 3600000)}h, ttl: ${ttlHours}h)`);
        return null;
      }
      
      // Download and parse content
      const download = await blobClient.download();
      const text = await streamToString(download.readableStreamBody);
      const data = JSON.parse(text) as T;
      
      console.log(`📦 Cache hit: ${key}`);
      
      return { data, cachedAt, ttlHours };
      
    } catch (error) {
      // Cache miss - don't log as error (expected case)
      return null;
    }
  }
  
  /**
   * Store document in cache
   * 
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttlHours - Time to live in hours
   */
  async set(key: string, data: unknown, ttlHours: number = CACHE_CONFIG.defaultTTLHours): Promise<void> {
    if (!this.enabled) return;
    
    try {
      await this.initialize();
      if (!this.containerClient) return;
      
      const blobClient = this.containerClient.getBlockBlobClient(key);
      const content = JSON.stringify(data);
      const contentBuffer = Buffer.from(content, 'utf-8');
      
      await blobClient.uploadData(contentBuffer, {
        metadata: {
          cachedat: new Date().toISOString(),
          ttlhours: ttlHours.toString()
        },
        blobHTTPHeaders: { 
          blobContentType: 'application/json' 
        }
      });
      
      console.log(`📦 Cache set: ${key} (ttl: ${ttlHours}h)`);
      
    } catch (error) {
      console.error(`❌ Cache set error for ${key}:`, error);
      // Don't throw - caching failures shouldn't break the app
    }
  }
  
  /**
   * Delete cached document
   * 
   * @param key - Cache key
   */
  async delete(key: string): Promise<void> {
    if (!this.enabled) return;
    
    try {
      await this.initialize();
      if (!this.containerClient) return;
      
      const blobClient = this.containerClient.getBlobClient(key);
      await blobClient.deleteIfExists();
      
      console.log(`📦 Cache deleted: ${key}`);
      
    } catch (error) {
      console.error(`❌ Cache delete error for ${key}:`, error);
    }
  }
  
  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
  
  // ==================== Static Key Generators ====================
  
  /**
   * Generate cache key for CFR section
   */
  static cfrKey(title: number, part: number, section: string): string {
    return `cfr/${title}/${part}/${section}.json`;
  }
  
  /**
   * Generate cache key for DRS document
   */
  static drsKey(docType: string, docNumber: string): string {
    const safeName = docNumber.replace(/[\s\/\\:*?"<>|]/g, '-');
    return `drs/${docType}/${safeName}.json`;
  }
  
  /**
   * Generate cache key for classifier result
   */
  static classifierKey(query: string): string {
    const hash = createHash('sha256')
      .update(query.toLowerCase().trim())
      .digest('hex')
      .slice(0, 16);
    return `classifier/${hash}.json`;
  }
  
  // ==================== TTL Constants ====================
  
  static get CFR_TTL_HOURS(): number {
    return CACHE_CONFIG.cfrTTLHours;
  }
  
  static get DRS_TTL_HOURS(): number {
    return CACHE_CONFIG.drsTTLHours;
  }
  
  static get CLASSIFIER_TTL_HOURS(): number {
    return CACHE_CONFIG.classifierTTLHours;
  }
}

/**
 * Convert readable stream to string
 */
async function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) return '';
  
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Singleton instance for reuse
 */
let cacheInstance: DocumentCache | null = null;

export function getDocumentCache(): DocumentCache {
  if (!cacheInstance) {
    cacheInstance = new DocumentCache();
  }
  return cacheInstance;
}
