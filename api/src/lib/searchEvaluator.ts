/**
 * Search Quality Evaluator
 * Determines if Azure Search results are sufficient or if DRS fallback is needed
 */

/**
 * Search quality evaluation result
 */
export interface SearchQuality {
  isSufficient: boolean;
  reason: string;
  score: number;
  specificDocMentioned?: string;
}

/**
 * Document from search results (minimal interface)
 */
export interface SearchDocument {
  title: string;
  score?: number;
  chunk?: string;
}

/**
 * Patterns for identifying specific FAA document references
 */
const DOC_PATTERNS: Record<string, RegExp> = {
  'AC': /\bAC\s+([\d\/.-]+[A-Z]?)/i,           // AC 43.13-1B, AC 150/5340-30J
  'AD': /\bAD\s+([\d-]+)/i,                     // AD 2023-01-05
  'CFR': /\b(14\s+)?CFR\s+(Part\s+)?(\d+(\.\d+)?)/i,  // 14 CFR Part 25, CFR 91.205
  'FAR': /\bFAR\s+(Part\s+)?(\d+(\.\d+)?)/i,   // FAR Part 23
  'TSO': /\bTSO[-\s]?([A-Z]?\d+[A-Za-z]?)/i,  // TSO-C129a
  'STC': /\bSTC\s*#?\s*([A-Z]{2}\d+[A-Z]{2})/i, // STC SA00001SE
  'Order': /\bOrder\s+(\d+\.\d+[A-Z]?)/i,      // Order 8900.1
};

/**
 * Relevance score threshold for considering results "good enough"
 */
const RELEVANCE_THRESHOLD = 0.7;

/**
 * Minimum number of results to consider search successful
 */
const MIN_RESULTS = 1;

/**
 * Evaluate if Azure Search results are sufficient to answer the question
 *
 * @param results - Search results from Azure AI Search
 * @param query - The user's original question
 * @returns SearchQuality indicating if results are sufficient
 */
export function evaluateSearchResults(
  results: SearchDocument[],
  query: string
): SearchQuality {
  // CHECK 1: Do we have any results?
  if (!results || results.length < MIN_RESULTS) {
    return {
      isSufficient: false,
      reason: 'No search results found',
      score: 0
    };
  }

  // CHECK 2: Are the results relevant? (based on search score)
  const topScore = results[0].score ?? 0;
  if (topScore < RELEVANCE_THRESHOLD) {
    return {
      isSufficient: false,
      reason: `Low relevance scores (top: ${topScore.toFixed(2)})`,
      score: topScore
    };
  }

  // CHECK 3: Does the query mention a specific document that's not in results?
  const specificDoc = extractSpecificDocument(query);

  if (specificDoc) {
    const docInResults = results.some(r =>
      r.title.toLowerCase().includes(specificDoc.toLowerCase()) ||
      (r.chunk && r.chunk.toLowerCase().includes(specificDoc.toLowerCase()))
    );

    if (!docInResults) {
      return {
        isSufficient: false,
        reason: `Specific document "${specificDoc}" not found in index`,
        score: topScore * 0.5,  // Penalize score
        specificDocMentioned: specificDoc
      };
    }
  }

  // All checks passed - Azure Search results are good!
  return {
    isSufficient: true,
    reason: 'Good search results',
    score: topScore
  };
}

/**
 * Extract specific document reference from query
 *
 * @param query - User's question
 * @returns Document reference string or null
 */
export function extractSpecificDocument(query: string): string | null {
  for (const [, pattern] of Object.entries(DOC_PATTERNS)) {
    const match = query.match(pattern);
    if (match) {
      // Return the full match (document type + number)
      return match[0].trim();
    }
  }
  return null;
}

/**
 * Extract document type from query for DRS API filtering
 * Note: DRS supports AC, AD, TSO, Order - NOT CFR (use eCFR.gov for that)
 *
 * @param query - User's question
 * @returns Document type code (AC, AD, etc.) or undefined
 */
export function extractDocumentType(query: string): string | undefined {
  // Check for explicit document type mentions
  if (/\bAC\s+[\d\/.-]/i.test(query) || /\bADVISORY\s+CIRCULAR/i.test(query)) {
    return 'AC';
  }
  if (/\bAD\s+[\d-]/i.test(query) || /\bAIRWORTHINESS\s+DIRECTIVE/i.test(query)) {
    return 'AD';
  }
  if (/\bTSO[-\s]?[A-Z]?\d/i.test(query)) {
    return 'TSO';
  }
  if (/\bORDER\s+\d/i.test(query)) {
    return 'Order';
  }

  // CFR/FAR queries - DRS doesn't have CFRs, but we can search for related ACs
  // that discuss the regulation requirements
  if (/\bCFR\b/i.test(query) || /\bCODE\s+OF\s+FEDERAL/i.test(query) || /\bFAR\s+(Part\s+)?\d/i.test(query)) {
    // Extract the part number for AC search
    const partMatch = query.match(/Part\s*(\d+)/i);
    if (partMatch) {
      // Return AC to search for advisory circulars about this part
      return 'AC';
    }
    // Skip DRS for generic CFR queries - Azure Search should handle these
    return undefined;
  }

  // STC queries - DRS doesn't have STCs in a searchable format
  if (/\bSTC\b/i.test(query)) {
    return undefined;  // Skip DRS for STC queries
  }

  // Check for topic-based inference
  if (/\b(maintenance|repair|inspection|overhaul)\b/i.test(query)) {
    return 'AC';  // Most maintenance guidance is in ACs
  }
  if (/\b(airworthiness|unsafe|mandatory)\b/i.test(query)) {
    return 'AD';  // Airworthiness concerns often relate to ADs
  }

  // Default: search ACs (most comprehensive)
  return 'AC';
}

/**
 * Get all document types to search when no specific type is identified
 */
export function getDefaultDocumentTypes(): string[] {
  return ['AC', 'AD', 'CFR'];
}
