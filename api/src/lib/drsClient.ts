import pdf from 'pdf-parse';
import { DocumentCache, getDocumentCache } from './documentCache';

/**
 * DRS Document metadata from API (raw response uses drs: prefix)
 */
export interface DRSDocumentRaw {
  'drs:documentNumber': string;
  'drs:title': string;
  'drs:status': string;
  'drs:docID': string;
  documentGuid: string;
  docLastModifiedDate: string;
  mainDocumentDownloadURL?: string;
  mainDocumentFileName?: string;
}

/**
 * Normalized DRS Document (for internal use)
 */
export interface DRSDocument {
  documentGuid: string;
  title: string;
  documentNumber: string;
  docLastModifiedDate: string;
  status?: string;
  mainDocumentDownloadURL?: string;
  mainDocumentFileName?: string;
}

/**
 * DRS API search result (raw response)
 */
export interface DRSSearchResultRaw {
  summary: {
    doctypeName: string;
    drsDoctypeName: string;
    count: number;
    hasMoreItems: boolean;
    totalItems: number;
    offset: number;
  };
  documents: DRSDocumentRaw[];
}

/**
 * Normalize raw DRS document to internal format
 */
function normalizeDRSDocument(raw: DRSDocumentRaw): DRSDocument {
  return {
    documentGuid: raw.documentGuid,
    title: raw['drs:title'] || raw['drs:documentNumber'] || 'Unknown',
    documentNumber: raw['drs:documentNumber'] || '',
    docLastModifiedDate: raw.docLastModifiedDate,
    status: raw['drs:status'],
    mainDocumentDownloadURL: raw.mainDocumentDownloadURL,
    mainDocumentFileName: raw.mainDocumentFileName
  };
}

/**
 * Client for FAA Dynamic Regulatory System (DRS) API
 * Provides access to comprehensive FAA regulatory documents
 */
export class DRSClient {
  private baseURL: string;
  private apiKey: string;
  private cache: DocumentCache;

  constructor() {
    this.baseURL = process.env.DRS_API_ENDPOINT || 'https://drs.faa.gov/api/drs';
    this.apiKey = process.env.DRS_API_KEY || '';
    this.cache = getDocumentCache();

    if (!this.apiKey) {
      console.warn('⚠️  DRS_API_KEY not configured');
    }
  }

  /**
   * Search for documents in DRS using filtered POST endpoint with keyword search
   * Supports multiple keywords and status filtering for better relevance
   * 
   * @param keywords Array of keywords to search in document content
   * @param docType Document type (AC, TSO, Order, etc.)
   * @param options Optional: status filter, max results, document number prefix filter
   * @returns Array of matching documents
   */
  async searchDocumentsFiltered(
    keywords: string[],
    docType: string,
    options: { statusFilter?: string[]; maxResults?: number; docNumberPrefix?: string } = {}
  ): Promise<DRSDocument[]> {
    const { statusFilter = ['Current'], maxResults = 10, docNumberPrefix } = options;
    const maxRetries = 2;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const prefixInfo = docNumberPrefix ? ` prefix=${docNumberPrefix}` : '';
        const retryInfo = attempt > 1 ? ` (retry ${attempt}/${maxRetries})` : '';
        console.log(`🔍 DRS filtered search: keywords=[${keywords.join(', ')}] type=${docType} status=${statusFilter.join(',')}${prefixInfo}${retryInfo}`);

        const url = `${this.baseURL}/data-pull/${docType}/filtered`;

        // Build document filters (max 5 filters, max 10 values per filter)
        const documentFilters: Record<string, string[]> = {
          'drs:status': statusFilter,
          'Keyword': keywords.slice(0, 10) // Max 10 keyword values
        };

        // Use AbortController for timeout (15 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            offset: 0,
            documentFilters
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('DRS API error response:', errorText);
          throw new Error(`DRS API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data?.documents || !Array.isArray(data.documents)) {
          console.warn('⚠️ DRS response has no documents array');
          return [];
        }

        console.log(`✅ DRS found ${data.documents.length} documents (total: ${data.summary?.totalItems || 'unknown'})`);

        // Filter by document number prefix if provided (e.g., "AC 23" for Part 23 ACs)
        let filteredDocs = data.documents;
        if (docNumberPrefix) {
          const prefixUpper = docNumberPrefix.toUpperCase();
          filteredDocs = data.documents.filter((doc: DRSDocumentRaw) => {
            const docNum = (doc['drs:documentNumber'] || '').toUpperCase();
            return docNum.startsWith(prefixUpper);
          });
          console.log(`  📌 Filtered to ${filteredDocs.length} docs matching prefix "${docNumberPrefix}"`);
        }

        // Normalize and limit results
        return filteredDocs.slice(0, maxResults).map(normalizeDRSDocument);

      } catch (error) {
        const isTimeout = error instanceof Error && 
          (error.name === 'AbortError' || error.message.includes('timeout') || error.message.includes('TIMEOUT'));
        
        if (isTimeout && attempt < maxRetries) {
          console.warn(`⏱️ DRS search timeout, retrying (${attempt}/${maxRetries})...`);
          continue;
        }
        
        console.error('❌ DRS filtered search error:', error);
        throw new Error(`DRS search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return []; // Should not reach here
  }

  /**
   * Search for documents in DRS by keyword and optional document type
   * @param query Search query
   * @param docType Optional document type (AC, AD, CFR, etc.)
   * @returns Array of matching documents
   */
  async searchDocuments(query: string, docType?: string): Promise<DRSDocument[]> {
    try {
      console.log(`🔍 Searching DRS for: "${query}" ${docType ? `(type: ${docType})` : ''}`);

      // If specific doc type provided, use it; otherwise search all types
      const searchDocType = docType || 'AC'; // Default to AC if not specified

      // Use filtered search with keyword
      const url = `${this.baseURL}/data-pull/${searchDocType}/filtered`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          offset: 0,
          documentFilters: {
            'Keyword': [query]
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('DRS API error response:', errorText);
        throw new Error(`DRS API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Log the actual response structure for debugging
      console.log('📋 DRS API response structure:', JSON.stringify(data, null, 2).substring(0, 500));

      // Handle different response formats
      if (!data || typeof data !== 'object') {
        console.warn('⚠️ DRS returned invalid response');
        return [];
      }

      // Check if documents array exists
      if (!data.documents || !Array.isArray(data.documents)) {
        console.warn('⚠️ DRS response has no documents array:', Object.keys(data));
        return [];
      }

      console.log(`✅ DRS found ${data.documents.length} documents (total: ${data.summary?.totalItems || 'unknown'})`);

      // Normalize the raw documents
      return data.documents.map(normalizeDRSDocument);

    } catch (error) {
      console.error('❌ DRS search error:', error);
      throw new Error(`DRS search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific document by its GUID
   * @param guid Document GUID
   * @param docType Document type (AC, AD, etc.)
   * @returns Document or null if not found
   */
  async getDocumentByGuid(guid: string, docType: string = 'AC'): Promise<DRSDocument | null> {
    try {
      const url = `${this.baseURL}/data-pull/${docType}/filtered`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentFilters: {
            'documentGuid': [guid]
          }
        })
      });

      if (!response.ok) {
        return null;
      }

      const data: DRSSearchResultRaw = await response.json();
      return data.documents.length > 0 ? normalizeDRSDocument(data.documents[0]) : null;

    } catch (error) {
      console.error(`❌ Error fetching document ${guid}:`, error);
      return null;
    }
  }

  /**
   * Download a document PDF using the direct download URL
   * @param downloadUrl The mainDocumentDownloadURL from search results
   * @returns PDF as Buffer
   */
  async downloadDocument(downloadUrl: string): Promise<Buffer> {
    try {
      console.log(`📥 Downloading document from: ${downloadUrl}`);

      const response = await fetch(downloadUrl, {
        headers: {
          'x-api-key': this.apiKey
        }
      });

      if (!response.ok) {
        throw new Error(`DRS download error: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`✅ Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

      return buffer;

    } catch (error) {
      console.error('❌ DRS download error:', error);
      throw new Error(`DRS download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract text from a PDF buffer
   * @param pdfBuffer PDF file as Buffer
   * @returns Extracted text content
   */
  async extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
    try {
      console.log('📄 Extracting text from PDF...');

      const data = await pdf(pdfBuffer);
      const text = data.text;

      console.log(`✅ Extracted ${text.length} characters from ${data.numpages} pages`);

      if (!text || text.trim().length === 0) {
        throw new Error('PDF appears to be empty or text extraction failed');
      }

      return text;

    } catch (error) {
      console.error('❌ PDF extraction error:', error);
      throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Normalize a document number for comparison
   * Handles variations like "AC23-8C" vs "AC 23-8C", lowercase, etc.
   */
  private normalizeDocNumber(docNum: string): string {
    return docNum
      .toUpperCase()
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .replace(/^(AC|AD|TSO|ORDER)\s*/, '$1 ')  // Ensure space after type prefix
      .trim();
  }

  /**
   * Extract the base document number (without CHG, Ed Update suffixes)
   * "AC 23-8C CHG 1" → "AC 23-8C"
   * "AC 23-8C Ed Update" → "AC 23-8C"
   */
  private getBaseDocNumber(docNum: string): string {
    const normalized = this.normalizeDocNumber(docNum);
    // Remove common suffixes: CHG #, Ed Update, Ed Update #
    return normalized
      .replace(/\s+(CHG|CHANGE)\s*\d*$/i, '')
      .replace(/\s+Ed\s+Update\s*\d*$/i, '')
      .trim();
  }

  /**
   * Search for a specific document by its number using hybrid approach:
   * 1. First tries exact document number match
   * 2. Then tries prefix match (for version variations like CHG 1)
   * 3. Falls back to keyword search if needed
   * 
   * @param docNumber Document number (e.g., "AC 23-8C")
   * @param docType Document type
   * @param statusFilter Optional status filter, defaults to Current
   * @returns Document or null if not found
   */
  async searchByDocumentNumber(
    docNumber: string, 
    docType: string,
    statusFilter: string[] = ['Current']
  ): Promise<DRSDocument | null> {
    const normalizedInput = this.normalizeDocNumber(docNumber);
    console.log(`🔍 Searching DRS for: "${normalizedInput}" (type: ${docType})`);

    try {
      // Step 1: Fetch all current documents of this type and find exact/prefix match
      // Use keyword search with the document number, then filter locally
      const url = `${this.baseURL}/data-pull/${docType}/filtered`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          offset: 0,
          documentFilters: {
            'drs:status': statusFilter,
            'Keyword': [docNumber]
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('DRS API error response:', errorText);
        throw new Error(`DRS API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📋 DRS API response structure:', JSON.stringify(data, null, 2).substring(0, 500));
      console.log(`✅ DRS found ${data.documents?.length || 0} documents (total: ${data.summary?.totalItems || 'unknown'})`);

      if (!data?.documents || !Array.isArray(data.documents) || data.documents.length === 0) {
        console.log(`⚠️ No documents found for "${docNumber}"`);
        return null;
      }

      const documents = data.documents.map(normalizeDRSDocument);

      // Step 2: Try exact match on document number
      const exactMatch = documents.find(doc => {
        const docNumNorm = this.normalizeDocNumber(doc.documentNumber);
        return docNumNorm === normalizedInput;
      });

      if (exactMatch) {
        console.log(`✅ Exact match found: ${exactMatch.documentNumber}`);
        return exactMatch;
      }

      // Step 3: Try base number match (handles CHG, Ed Update variations)
      const baseInputNum = this.getBaseDocNumber(normalizedInput);
      const baseMatch = documents.find(doc => {
        const baseDocNum = this.getBaseDocNumber(doc.documentNumber);
        return baseDocNum === baseInputNum;
      });

      if (baseMatch) {
        console.log(`✅ Base number match found: ${baseMatch.documentNumber} (requested: ${normalizedInput})`);
        return baseMatch;
      }

      // Step 4: Try prefix match (e.g., "AC 23-8" matches "AC 23-8C")
      const prefixMatch = documents.find(doc => {
        const docNumNorm = this.normalizeDocNumber(doc.documentNumber);
        const baseDocNum = this.getBaseDocNumber(doc.documentNumber);
        return docNumNorm.startsWith(normalizedInput) || baseDocNum.startsWith(normalizedInput);
      });

      if (prefixMatch) {
        console.log(`✅ Prefix match found: ${prefixMatch.documentNumber} (requested: ${normalizedInput})`);
        return prefixMatch;
      }

      // Step 5: Check if any document number contains the requested number
      const containsMatch = documents.find(doc => {
        const docNumNorm = this.normalizeDocNumber(doc.documentNumber);
        return docNumNorm.includes(normalizedInput) || normalizedInput.includes(this.getBaseDocNumber(docNumNorm));
      });

      if (containsMatch) {
        console.log(`✅ Contains match found: ${containsMatch.documentNumber} (requested: ${normalizedInput})`);
        return containsMatch;
      }

      // No good match found
      console.log(`⚠️ No matching document found for "${normalizedInput}". Available: ${documents.slice(0, 5).map(d => d.documentNumber).join(', ')}...`);
      return null;

    } catch (error) {
      console.error(`❌ Error searching for ${docNumber}:`, error);
      return null;
    }
  }

  /**
   * Cache-first document fetch with text extraction
   * Returns cached text if available, otherwise fetches, extracts, and caches
   * 
   * @param docNumber Document number (e.g., "AC 23-8C")
   * @param docType Document type (AC, AD, TSO, etc.)
   * @returns Extracted text and metadata, or null if not found
   */
  async fetchDocumentWithCache(
    docNumber: string,
    docType: string
  ): Promise<{ text: string; doc: DRSDocument } | null> {
    const cacheKey = DocumentCache.drsKey(docType, docNumber);
    
    // Try cache first
    const cached = await this.cache.get<{ text: string; doc: DRSDocument }>(cacheKey);
    if (cached) {
      console.log(`📦 DRS cache hit: ${docType}/${docNumber}`);
      return cached.data;
    }
    
    // Search for document
    const doc = await this.searchByDocumentNumber(docNumber, docType);
    if (!doc) {
      console.log(`❌ Document not found: ${docType}/${docNumber}`);
      return null;
    }
    
    // Need download URL
    if (!doc.mainDocumentDownloadURL) {
      console.log(`❌ No download URL for: ${docType}/${docNumber}`);
      return null;
    }
    
    try {
      // Download and extract
      const pdfBuffer = await this.downloadDocument(doc.mainDocumentDownloadURL);
      const text = await this.extractTextFromPDF(pdfBuffer);
      
      const result = { text, doc };
      
      // Cache the result
      await this.cache.set(cacheKey, result, DocumentCache.DRS_TTL_HOURS);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Failed to fetch/extract ${docType}/${docNumber}:`, error);
      return null;
    }
  }

  /**
   * Fetch document directly using pre-fetched metadata (no additional search)
   * Use this when you already have document metadata from searchDocumentsFiltered
   * 
   * @param doc Document metadata with downloadURL
   * @param docType Document type (for cache key)
   * @returns Extracted text and metadata, or null if failed
   */
  async fetchDocumentDirect(
    doc: DRSDocument,
    docType: string
  ): Promise<{ text: string; doc: DRSDocument } | null> {
    if (!doc.mainDocumentDownloadURL) {
      console.log(`❌ No download URL for: ${doc.documentNumber}`);
      return null;
    }
    
    const cacheKey = DocumentCache.drsKey(docType, doc.documentNumber);
    
    // Try cache first
    const cached = await this.cache.get<{ text: string; doc: DRSDocument }>(cacheKey);
    if (cached) {
      console.log(`📦 DRS cache hit: ${docType}/${doc.documentNumber}`);
      return cached.data;
    }
    
    try {
      // Download and extract directly - no need to search again
      const pdfBuffer = await this.downloadDocument(doc.mainDocumentDownloadURL);
      const text = await this.extractTextFromPDF(pdfBuffer);
      
      const result = { text, doc };
      
      // Cache the result
      await this.cache.set(cacheKey, result, DocumentCache.DRS_TTL_HOURS);
      
      return result;
      
    } catch (error) {
      console.error(`❌ Failed to fetch/extract ${doc.documentNumber}:`, error);
      return null;
    }
  }

  /**
   * Fetch multiple documents with caching (parallel)
   * 
   * @param requests Array of { docNumber, docType }
   * @returns Array of results (null for failures)
   */
  async fetchDocumentsWithCache(
    requests: Array<{ docNumber: string; docType: string }>
  ): Promise<Array<{ text: string; doc: DRSDocument } | null>> {
    return Promise.all(
      requests.map(req => this.fetchDocumentWithCache(req.docNumber, req.docType))
    );
  }
}
