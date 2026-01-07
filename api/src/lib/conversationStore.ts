/**
 * Conversation Store
 * Blob Storage-based storage for multi-turn conversations
 * Uses 7-day TTL with lazy cleanup
 */

import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { v4 as uuidv4 } from "uuid";

/**
 * A single turn in a conversation
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  // For assistant turns, include sources used
  sources?: string[];
  // Was this a clarifying question?
  isClarifying?: boolean;
}

/**
 * Stored conversation metadata and history
 */
export interface StoredConversation {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  turns: ConversationTurn[];
}

/**
 * Configuration
 */
const CONVERSATION_CONFIG = {
  containerName: 'conversations',
  ttlDays: 7,
  maxTurns: 20, // Limit conversation length
};

/**
 * Helper to read stream to string
 */
async function streamToString(stream: NodeJS.ReadableStream | undefined): Promise<string> {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Conversation Store using Azure Blob Storage
 * Falls back to in-memory storage for local development
 */
export class ConversationStore {
  private containerClient: ContainerClient | null = null;
  private initPromise: Promise<void> | null = null;
  private enabled: boolean = true;
  private useMemoryFallback: boolean = false;
  private memoryStore: Map<string, StoredConversation> = new Map();
  
  constructor() {
    const connectionString = process.env.BLOB_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
    if (!connectionString || connectionString === 'UseDevelopmentStorage=true') {
      console.warn('⚠️  ConversationStore: No Azure Storage configured, using in-memory fallback');
      this.enabled = true;  // Keep enabled but use memory
      this.useMemoryFallback = true;
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
        const connectionString = process.env.BLOB_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
        if (!connectionString) {
          throw new Error('No storage connection string found');
        }
        const blobService = BlobServiceClient.fromConnectionString(connectionString);
        this.containerClient = blobService.getContainerClient(CONVERSATION_CONFIG.containerName);
        
        await this.containerClient.createIfNotExists();
        console.log(`✅ ConversationStore initialized: ${CONVERSATION_CONFIG.containerName}`);
      } catch (error) {
        console.error('❌ ConversationStore initialization failed:', error);
        this.enabled = false;
      }
    })();
    
    await this.initPromise;
  }
  
  /**
   * Generate a new session ID
   */
  generateSessionId(): string {
    return uuidv4();
  }
  
  /**
   * Get a conversation by session ID
   * Returns null if not found or expired
   */
  async get(sessionId: string): Promise<StoredConversation | null> {
    if (!this.enabled) return null;
    
    // In-memory fallback for local development
    if (this.useMemoryFallback) {
      const conversation = this.memoryStore.get(sessionId);
      if (conversation) {
        console.log(`💬 Conversation loaded (memory): ${sessionId} (${conversation.turns.length} turns)`);
      }
      return conversation || null;
    }
    
    try {
      await this.initialize();
      if (!this.containerClient) return null;
      
      const blobClient = this.containerClient.getBlobClient(`${sessionId}.json`);
      
      const exists = await blobClient.exists();
      if (!exists) {
        return null;
      }
      
      const props = await blobClient.getProperties();
      const updatedAt = props.metadata?.updatedat 
        ? parseInt(props.metadata.updatedat) 
        : (props.lastModified?.getTime() || Date.now());
      
      // Check TTL
      const ageMs = Date.now() - updatedAt;
      const ttlMs = CONVERSATION_CONFIG.ttlDays * 24 * 3600000;
      
      if (ageMs > ttlMs) {
        console.log(`💬 Conversation expired: ${sessionId}`);
        // Lazy cleanup - delete expired conversation
        await blobClient.deleteIfExists();
        return null;
      }
      
      const download = await blobClient.download();
      const text = await streamToString(download.readableStreamBody);
      const conversation = JSON.parse(text) as StoredConversation;
      
      console.log(`💬 Conversation loaded: ${sessionId} (${conversation.turns.length} turns)`);
      
      return conversation;
      
    } catch (error) {
      console.error(`❌ Error loading conversation ${sessionId}:`, error);
      return null;
    }
  }
  
  /**
   * Save a conversation
   */
  async save(conversation: StoredConversation): Promise<void> {
    if (!this.enabled) return;
    
    // Enforce max turns limit
    if (conversation.turns.length > CONVERSATION_CONFIG.maxTurns) {
      conversation.turns = conversation.turns.slice(-CONVERSATION_CONFIG.maxTurns);
    }
    
    conversation.updatedAt = Date.now();
    
    // In-memory fallback for local development
    if (this.useMemoryFallback) {
      this.memoryStore.set(conversation.sessionId, conversation);
      console.log(`💬 Conversation saved (memory): ${conversation.sessionId} (${conversation.turns.length} turns)`);
      return;
    }
    
    try {
      await this.initialize();
      if (!this.containerClient) return;
      
      const blobClient = this.containerClient.getBlockBlobClient(`${conversation.sessionId}.json`);
      const content = JSON.stringify(conversation);
      const contentBuffer = Buffer.from(content, 'utf-8');
      
      await blobClient.uploadData(contentBuffer, {
        metadata: {
          createdat: conversation.createdAt.toString(),
          updatedat: conversation.updatedAt.toString(),
          turns: conversation.turns.length.toString()
        },
        blobHTTPHeaders: { 
          blobContentType: 'application/json' 
        }
      });
      
      console.log(`💬 Conversation saved: ${conversation.sessionId} (${conversation.turns.length} turns)`);
      
    } catch (error) {
      console.error(`❌ Error saving conversation:`, error);
    }
  }
  
  /**
   * Add a turn to a conversation (creates if doesn't exist)
   */
  async addTurn(sessionId: string, turn: ConversationTurn): Promise<StoredConversation> {
    let conversation = await this.get(sessionId);
    
    if (!conversation) {
      conversation = {
        sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        turns: []
      };
    }
    
    conversation.turns.push(turn);
    await this.save(conversation);
    
    return conversation;
  }
  
  /**
   * Delete a conversation
   */
  async delete(sessionId: string): Promise<void> {
    if (!this.enabled) return;
    
    try {
      await this.initialize();
      if (!this.containerClient) return;
      
      const blobClient = this.containerClient.getBlobClient(`${sessionId}.json`);
      await blobClient.deleteIfExists();
      
      console.log(`💬 Conversation deleted: ${sessionId}`);
      
    } catch (error) {
      console.error(`❌ Error deleting conversation ${sessionId}:`, error);
    }
  }
  
  /**
   * Format conversation history for Claude context
   * Always includes full content for optimal context understanding
   * 
   * @param conversation - The conversation to format
   * @param maxTurns - Maximum number of turns to include (default 10)
   */
  formatForContext(
    conversation: StoredConversation | null, 
    maxTurns: number = 10
  ): string {
    if (!conversation || conversation.turns.length === 0) {
      return '';
    }
    
    const recentTurns = conversation.turns.slice(-maxTurns);
    
    let context = '# Previous Conversation\n\n';
    
    for (const turn of recentTurns) {
      if (turn.role === 'user') {
        context += `**User:** ${turn.content}\n\n`;
      } else {
        // Include full responses (cap at 10k chars for very long answers)
        const answer = turn.content.length > 10000
          ? turn.content.substring(0, 10000) + '...'
          : turn.content;
        context += `**Assistant:** ${answer}\n\n`;
      }
    }
    
    return context;
  }
  
  /**
   * Check if storage is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let conversationStoreInstance: ConversationStore | null = null;

export function getConversationStore(): ConversationStore {
  if (!conversationStoreInstance) {
    conversationStoreInstance = new ConversationStore();
  }
  return conversationStoreInstance;
}
