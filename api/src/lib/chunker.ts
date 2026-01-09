/**
 * Claude-based semantic document chunking
 * 
 * Uses Claude to intelligently identify logical section boundaries in FAA documents,
 * respecting § references, chapters, and topic transitions for better retrieval.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "./anthropic";

// Configuration
const CHUNK_CONFIG = {
  model: process.env.CHUNK_MODEL || 'claude-sonnet-4-20250514',
  targetSize: parseInt(process.env.CHUNK_TARGET_SIZE || '2000'),  // Target chars per chunk
  maxChunksPerDoc: parseInt(process.env.CHUNK_MAX_PER_DOC || '50'),  // Safety limit
  minChunkSize: parseInt(process.env.CHUNK_MIN_SIZE || '500'),  // Don't create tiny chunks
};

/**
 * A semantic chunk of a document
 */
export interface DocumentChunk {
  content: string;           // The chunk text
  index: number;             // 0-based chunk index
  title?: string;            // Section title if identified
  startChar: number;         // Start position in original doc
  endChar: number;           // End position in original doc
}

/**
 * Result of chunking a document
 */
export interface ChunkingResult {
  chunks: DocumentChunk[];
  totalChunks: number;
  method: 'claude' | 'fallback';  // Which method was used
}

/**
 * Chunk a document using Claude to identify semantic boundaries
 * 
 * Claude analyzes the document structure and returns chunk boundary positions,
 * respecting logical sections like chapters, § references, and topic changes.
 */
export async function chunkDocumentWithClaude(
  text: string,
  documentTitle: string,
): Promise<ChunkingResult> {
  // For very short documents, don't chunk
  if (text.length <= CHUNK_CONFIG.targetSize) {
    return {
      chunks: [{
        content: text.trim(),
        index: 0,
        startChar: 0,
        endChar: text.length,
      }],
      totalChunks: 1,
      method: 'claude',
    };
  }

  try {
    const anthropic = createAnthropicClient();
    
    // For very long documents, we need to truncate for the analysis
    // Claude will analyze structure and return boundary positions
    const analysisLimit = 100000; // ~25K tokens for analysis
    const textForAnalysis = text.length > analysisLimit 
      ? text.substring(0, analysisLimit) + "\n\n[... document continues ...]"
      : text;
    
    const response = await anthropic.messages.create({
      model: CHUNK_CONFIG.model,
      max_tokens: 4096,
      system: `You are a document structure analyzer for FAA regulatory documents (ACs, ADs, TSOs, CFR sections).

Your task: Identify logical section boundaries for chunking. Each chunk should be ~${CHUNK_CONFIG.targetSize} characters.

For FAA documents, good boundaries are:
- Chapter/section headings (e.g., "CHAPTER 1", "Section 3")
- Numbered paragraphs (e.g., "1.", "2.a.", "3.1")
- CFR section references (e.g., "§ 23.2150", "14 CFR 25.1181")
- Major topic transitions
- Tables of contents entries
- Appendix boundaries

Return ONLY a JSON array of boundary objects. Each boundary marks where a NEW chunk should START.
Format: [{"pos": <character_position>, "title": "<brief_section_title>"}]

Rules:
- First boundary is always {"pos": 0, "title": "..."}
- Aim for ${Math.ceil(text.length / CHUNK_CONFIG.targetSize)} chunks (document is ${text.length} chars)
- Maximum ${CHUNK_CONFIG.maxChunksPerDoc} boundaries
- Positions must be valid character indices in the document
- Try to break at paragraph boundaries (after \\n\\n) near target positions`,
      messages: [{
        role: "user",
        content: `Analyze this FAA document and return chunk boundaries as JSON:

Document: "${documentTitle}"
Length: ${text.length} characters

---
${textForAnalysis}
---

Return JSON array of boundaries:`
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Parse Claude's response
    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('Could not parse chunk boundaries from Claude, using fallback');
      return chunkDocumentFallback(text);
    }

    const boundaries: Array<{ pos: number; title?: string }> = JSON.parse(jsonMatch[0]);
    
    if (!boundaries.length) {
      return chunkDocumentFallback(text);
    }

    // Convert boundaries to chunks
    const chunks: DocumentChunk[] = [];
    for (let i = 0; i < boundaries.length && i < CHUNK_CONFIG.maxChunksPerDoc; i++) {
      const start = Math.max(0, Math.min(boundaries[i].pos, text.length - 1));
      const end = i < boundaries.length - 1 
        ? Math.min(boundaries[i + 1].pos, text.length)
        : text.length;
      
      const chunkContent = text.slice(start, end).trim();
      
      // Skip empty or too-small chunks
      if (chunkContent.length < CHUNK_CONFIG.minChunkSize && i < boundaries.length - 1) {
        continue;
      }

      chunks.push({
        content: chunkContent,
        index: chunks.length,
        title: boundaries[i].title,
        startChar: start,
        endChar: end,
      });
    }

    // If Claude's chunking failed, use fallback
    if (chunks.length === 0) {
      return chunkDocumentFallback(text);
    }

    console.log(`✂️ Claude chunked "${documentTitle}" into ${chunks.length} semantic chunks`);
    
    return {
      chunks,
      totalChunks: chunks.length,
      method: 'claude',
    };

  } catch (error) {
    console.error('Claude chunking failed, using fallback:', error);
    return chunkDocumentFallback(text);
  }
}

/**
 * Fallback chunking using fixed-length with overlap
 * Used when Claude chunking fails or is unavailable
 */
export function chunkDocumentFallback(text: string): ChunkingResult {
  const chunkSize = CHUNK_CONFIG.targetSize;
  const overlap = Math.floor(chunkSize * 0.1); // 10% overlap
  const minSize = CHUNK_CONFIG.minChunkSize;

  const chunks: DocumentChunk[] = [];
  let startChar = 0;
  let index = 0;

  while (startChar < text.length && index < CHUNK_CONFIG.maxChunksPerDoc) {
    let endChar = Math.min(startChar + chunkSize, text.length);
    
    // Try to break at paragraph or sentence boundary
    if (endChar < text.length) {
      // Look for paragraph break
      const lastParagraph = text.lastIndexOf('\n\n', endChar);
      if (lastParagraph > startChar + minSize) {
        endChar = lastParagraph + 2;
      } else {
        // Look for sentence break
        const lastSentence = text.lastIndexOf('. ', endChar);
        if (lastSentence > startChar + minSize) {
          endChar = lastSentence + 2;
        }
      }
    }

    const chunkContent = text.slice(startChar, endChar).trim();
    
    if (chunkContent.length >= minSize || startChar + chunkSize >= text.length) {
      chunks.push({
        content: chunkContent,
        index,
        startChar,
        endChar,
      });
      index++;
    }

    // Move forward with overlap
    startChar = endChar - overlap;
    if (startChar >= text.length - minSize) break;
  }

  console.log(`✂️ Fallback chunked document into ${chunks.length} fixed-length chunks`);

  return {
    chunks,
    totalChunks: chunks.length,
    method: 'fallback',
  };
}

/**
 * Check if chunking is needed for a document
 */
export function needsChunking(textLength: number): boolean {
  return textLength > CHUNK_CONFIG.targetSize;
}

/**
 * Get chunk configuration (for debugging/monitoring)
 */
export function getChunkConfig() {
  return { ...CHUNK_CONFIG };
}
