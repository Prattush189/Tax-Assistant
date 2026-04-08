import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──

interface Chunk {
  id: number;
  source: 'act-2025' | 'act-1961';
  section: string;
  text: string;
}

// ── Stopwords to skip during scoring ──

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'been', 'have', 'has', 'had', 'not', 'but', 'what', 'all', 'can', 'her',
  'his', 'him', 'how', 'its', 'may', 'who', 'will', 'shall', 'any', 'such',
  'than', 'other', 'which', 'where', 'when', 'there', 'into', 'under', 'being',
  'upon', 'about', 'between', 'through', 'during', 'before', 'after', 'above',
  'below', 'each', 'every', 'some', 'does', 'did', 'also', 'only', 'just',
  'per', 'sub', 'section', 'clause', 'act', 'provision', 'referred',
]);

// ── Section-based text splitter ──

function splitIntoSections(text: string): { section: string; text: string }[] {
  // Match section headers like "80C." or "115BAC." or "194A." at start of line
  // Also match numbered sections like "1. (1)" or "24. (1)"
  const sectionRegex = /^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm;
  const matches = [...text.matchAll(sectionRegex)];

  if (matches.length === 0) {
    return [{ section: 'general', text: text.trim() }];
  }

  const sections: { section: string; text: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const sectionText = text.slice(start, end).trim();

    // Skip very short sections (footnotes, amendments references)
    if (sectionText.length < 50) continue;

    sections.push({
      section: matches[i][1],
      text: sectionText,
    });
  }

  return sections;
}

// ── Sub-chunk large sections with overlap ──

const MAX_CHUNK_SIZE = 2000;
const CHUNK_OVERLAP = 200;

function subChunk(text: string, section: string): { section: string; text: string }[] {
  if (text.length <= MAX_CHUNK_SIZE) {
    return [{ section, text }];
  }

  const chunks: { section: string; text: string }[] = [];
  let start = 0;
  let part = 1;
  while (start < text.length) {
    const end = Math.min(start + MAX_CHUNK_SIZE, text.length);
    chunks.push({
      section: `${section} (part ${part})`,
      text: text.slice(start, end),
    });
    start += MAX_CHUNK_SIZE - CHUNK_OVERLAP;
    part++;
  }
  return chunks;
}

// ── Build chunks from a source file ──

function buildChunks(filePath: string, source: Chunk['source']): Chunk[] {
  const text = readFileSync(filePath, 'utf-8');
  const sections = splitIntoSections(text);
  const chunks: Chunk[] = [];
  let id = 0;

  for (const sec of sections) {
    const subChunks = subChunk(sec.text, sec.section);
    for (const sc of subChunks) {
      chunks.push({ id: id++, source, section: sc.section, text: sc.text });
    }
  }

  return chunks;
}

// ── Keyword scoring ──

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function scoreChunk(chunk: Chunk, tokens: string[]): number {
  const lower = chunk.text.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    // Count occurrences
    let idx = 0;
    while ((idx = lower.indexOf(token, idx)) !== -1) {
      score++;
      idx += token.length;
    }
  }

  // Boost if section number matches a token (e.g., query mentions "80C")
  const sectionLower = chunk.section.toLowerCase();
  for (const token of tokens) {
    if (sectionLower.includes(token)) {
      score += 10; // Strong boost for section match
    }
  }

  return score;
}

// ── Retrieve top chunks ──

function retrieve(chunks: Chunk[], query: string, topK = 5): Chunk[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  // Also extract section numbers from query (e.g., "80C", "194A", "115BAC")
  const sectionNumbers = query.match(/\d+[A-Z]*/g) || [];
  const allTokens = [...tokens, ...sectionNumbers.map(s => s.toLowerCase())];
  const uniqueTokens = [...new Set(allTokens)];

  const scored = chunks
    .map(chunk => ({ chunk, score: scoreChunk(chunk, uniqueTokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(s => s.chunk);
}

// ── Initialize at startup ──

let allChunks: Chunk[] = [];

export function initRAG(): void {
  const dataDir = join(__dirname, '..', 'data');

  try {
    const chunks2025 = buildChunks(join(dataDir, 'act-2025.txt'), 'act-2025');
    console.log(`[RAG] Loaded act-2025: ${chunks2025.length} chunks`);
    allChunks.push(...chunks2025);
  } catch (err) {
    console.warn('[RAG] act-2025.txt not found, skipping');
  }

  try {
    const chunks1961 = buildChunks(join(dataDir, 'act-1961.txt'), 'act-1961');
    console.log(`[RAG] Loaded act-1961: ${chunks1961.length} chunks`);
    allChunks.push(...chunks1961);
  } catch (err) {
    console.warn('[RAG] act-1961.txt not found, skipping');
  }

  console.log(`[RAG] Total chunks: ${allChunks.length}`);
}

export function retrieveContext(query: string, topK = 5): string | null {
  const chunks = retrieve(allChunks, query, topK);
  if (chunks.length === 0) return null;

  const context = chunks
    .map((c, i) => `[${c.source === 'act-2025' ? 'IT Act 2025' : 'IT Act 1961'} — Section ${c.section}]\n${c.text}`)
    .join('\n\n---\n\n');

  return context;
}
