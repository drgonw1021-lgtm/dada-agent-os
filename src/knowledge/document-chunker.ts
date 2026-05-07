/**
 * Document chunking — splits text into overlapping chunks for semantic retrieval.
 * Uses paragraph boundaries for natural break points, sliding-window overlap.
 */

export interface TextChunk {
  text: string;
  startChar: number;
  endChar: number;
  /** Estimated token count (4 chars ≈ 1 token) */
  estimatedTokens: number;
}

export interface ChunkOptions {
  /** Target chunk size in characters (default 1000) */
  chunkSize?: number;
  /** Overlap in characters (default 200) */
  overlap?: number;
  /** Maximum chunks per document (default 50) */
  maxChunks?: number;
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 200;
const MAX_CHUNKS = 50;

export function chunkDocument(
  text: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const maxChunks = options.maxChunks ?? MAX_CHUNKS;

  if (text.length <= chunkSize) {
    return [{
      text: text.trim(),
      startChar: 0,
      endChar: text.length,
      estimatedTokens: Math.ceil(text.length / 4)
    }];
  }

  // Split on paragraph boundaries, then apply sliding window
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks: TextChunk[] = [];

  let offset = 0;
  let chunkStart = 0;

  while (chunkStart < text.length && chunks.length < maxChunks) {
    const chunkEnd = Math.min(chunkStart + chunkSize, text.length);

    // Try to end at a paragraph boundary
    let adjustedEnd = chunkEnd;
    if (chunkEnd < text.length) {
      const paraBreak = text.lastIndexOf("\n\n", chunkEnd);
      if (paraBreak > chunkStart + chunkSize / 2) {
        adjustedEnd = paraBreak;
      } else {
        const newline = text.lastIndexOf("\n", chunkEnd);
        if (newline > chunkStart + chunkSize / 2) {
          adjustedEnd = newline;
        }
      }
    }

    const chunkText = text.slice(chunkStart, adjustedEnd).trim();
    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        startChar: chunkStart,
        endChar: adjustedEnd,
        estimatedTokens: Math.ceil(chunkText.length / 4)
      });
    }

    chunkStart = adjustedEnd - overlap;
    if (chunkStart <= 0 || chunkStart >= text.length) break;
    // Ensure forward progress
    const lastStart = chunks.length > 0 ? chunks[chunks.length - 1]!.startChar : 0;
    if (chunkStart <= lastStart) {
      chunkStart = lastStart + Math.floor(chunkSize / 2);
    }
  }

  if (chunks.length === 0) {
    chunks.push({
      text: text.slice(0, chunkSize),
      startChar: 0,
      endChar: Math.min(chunkSize, text.length),
      estimatedTokens: Math.ceil(Math.min(chunkSize, text.length) / 4)
    });
  }

  return chunks.slice(0, maxChunks);
}
