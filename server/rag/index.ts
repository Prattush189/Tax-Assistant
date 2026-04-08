import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──

interface Chunk {
  id: number;
  source: 'act-2025' | 'act-1961' | 'comparison';
  section: string;
  text: string;
  lowerText: string; // pre-computed for scoring
}

// ── Stopwords to skip during scoring ──

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'been', 'have', 'has', 'had', 'not', 'but', 'what', 'all', 'can', 'her',
  'his', 'him', 'how', 'its', 'may', 'who', 'will', 'shall', 'any', 'such',
  'than', 'other', 'which', 'where', 'when', 'there', 'into', 'under', 'being',
  'upon', 'about', 'between', 'through', 'during', 'before', 'after', 'above',
  'below', 'each', 'every', 'some', 'does', 'did', 'also', 'only', 'just',
  'per', 'sub', 'referred', 'case', 'respect', 'mentioned', 'said', 'person',
  'amount', 'income', 'total', 'purposes', 'provisions', 'provided',
]);

// ── Section-based text splitter ──

function splitIntoSections(text: string): { section: string; text: string }[] {
  // Match section starts: "80C. " or "393. (1)" at line start
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

    if (sectionText.length < 50) continue;

    sections.push({
      section: matches[i][1],
      text: sectionText,
    });
  }

  return sections;
}

// ── Sub-chunk large sections with overlap ──

const MAX_CHUNK_SIZE = 1200;
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

// ── Split comparison file by ====== headers ──

function splitComparisonSections(text: string): { section: string; text: string }[] {
  const parts = text.split(/^={3,}$/gm);
  const sections: { section: string; text: string }[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.length < 50) continue;

    // Extract section title from first line (e.g., "3. TDS SECTION MAPPING")
    const firstLine = trimmed.split('\n')[0].trim();
    const match = firstLine.match(/^\d+\.\s*(.+)/);
    const section = match ? match[1].trim() : firstLine.slice(0, 60);

    sections.push({ section, text: trimmed });
  }

  return sections;
}

// ── Build chunks from a source file ──

function buildChunks(filePath: string, source: Chunk['source']): Chunk[] {
  const text = readFileSync(filePath, 'utf-8');
  const sections = source === 'comparison'
    ? splitComparisonSections(text)
    : splitIntoSections(text);
  const chunks: Chunk[] = [];
  let id = 0;

  for (const sec of sections) {
    const subChunks = subChunk(sec.text, sec.section);
    for (const sc of subChunks) {
      chunks.push({
        id: id++,
        source,
        section: sc.section,
        text: sc.text,
        lowerText: sc.text.toLowerCase(),
      });
    }
  }

  return chunks;
}

// ── Inverted index for fast lookup ──

const invertedIndex = new Map<string, Set<number>>(); // token → chunk IDs

function buildIndex(chunks: Chunk[]): void {
  invertedIndex.clear();
  for (const chunk of chunks) {
    const words = chunk.lowerText.split(/\s+/).filter(w => w.length > 2);
    for (const word of words) {
      if (!invertedIndex.has(word)) invertedIndex.set(word, new Set());
      invertedIndex.get(word)!.add(chunk.id);
    }
    // Also index section number
    const secLower = chunk.section.toLowerCase().replace(/\s*\(part.*/, '');
    if (secLower) {
      if (!invertedIndex.has(secLower)) invertedIndex.set(secLower, new Set());
      invertedIndex.get(secLower)!.add(chunk.id);
    }
  }
}

// ── Keyword scoring ──

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function scoreChunk(chunk: Chunk, tokens: string[], sectionNumbers: string[]): number {
  let score = 0;

  for (const token of tokens) {
    let idx = 0;
    while ((idx = chunk.lowerText.indexOf(token, idx)) !== -1) {
      score++;
      idx += token.length;
    }
  }

  const sectionLower = chunk.section.toLowerCase();
  for (const secNum of sectionNumbers) {
    if (sectionLower === secNum.toLowerCase() || sectionLower.startsWith(secNum.toLowerCase() + ' ')) {
      score += 50;
    }
  }

  for (const secNum of sectionNumbers) {
    const secLower = secNum.toLowerCase();
    if (chunk.lowerText.includes(`section ${secLower}`) || chunk.lowerText.includes(`sec. ${secLower}`)) {
      score += 15;
    }
    if (chunk.lowerText.includes(secLower)) {
      score += 10;
    }
  }

  if (chunk.source === 'comparison' && score > 0) {
    score = Math.ceil(score * 1.5);
  }

  return score;
}

// ── Retrieve top chunks using inverted index ──

function retrieve(chunks: Chunk[], query: string, topK = 3): Chunk[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const sectionNumbers = query.match(/\b\d+[A-Z]*\b/g) || [];

  // Use inverted index to get candidate chunks (instead of scanning all)
  const candidateIds = new Set<number>();
  for (const token of tokens) {
    const ids = invertedIndex.get(token);
    if (ids) ids.forEach(id => candidateIds.add(id));
  }
  for (const sec of sectionNumbers) {
    const ids = invertedIndex.get(sec.toLowerCase());
    if (ids) ids.forEach(id => candidateIds.add(id));
  }

  if (candidateIds.size === 0) return [];

  // Only score candidate chunks, not all chunks
  const candidates = [...candidateIds].map(id => chunks[id]).filter(Boolean);

  const scored = candidates
    .map(chunk => ({ chunk, score: scoreChunk(chunk, tokens, sectionNumbers) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score < 2) return [];

  // Ensure balanced results: comparison + both acts
  const fromComparison: typeof scored = [];
  const from2025: typeof scored = [];
  const from1961: typeof scored = [];

  for (const s of scored) {
    if (s.chunk.source === 'comparison' && fromComparison.length < 1) {
      fromComparison.push(s);
    } else if (s.chunk.source === 'act-2025' && from2025.length < 1) {
      from2025.push(s);
    } else if (s.chunk.source === 'act-1961' && from1961.length < 1) {
      from1961.push(s);
    }
    if (fromComparison.length + from2025.length + from1961.length >= topK) break;
  }

  // Fill remaining slots from highest-scoring unused results
  const used = new Set([...fromComparison, ...from2025, ...from1961].map(s => s.chunk.id));
  const remaining = scored.filter(s => !used.has(s.chunk.id));
  const combined = [...fromComparison, ...from2025, ...from1961];
  for (const s of remaining) {
    if (combined.length >= topK) break;
    combined.push(s);
  }

  const balanced = combined
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return balanced.map(s => s.chunk);
}

// ── Initialize at startup ──

let allChunks: Chunk[] = [];

export function initRAG(): void {
  const dataDir = join(__dirname, '..', 'data');

  // Load comparison mapping first (highest priority for cross-reference queries)
  try {
    const chunksComp = buildChunks(join(dataDir, 'comparison.txt'), 'comparison');
    console.log(`[RAG] Loaded comparison: ${chunksComp.length} chunks`);
    allChunks.push(...chunksComp);
  } catch (err) {
    console.warn('[RAG] comparison.txt not found, skipping');
  }

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

  // Build inverted index for fast lookup
  buildIndex(allChunks);
  console.log(`[RAG] Total chunks: ${allChunks.length}, index keys: ${invertedIndex.size}`);
}

// Progressively broaden section numbers: 15CG → 15C → 15
function broadenSectionNumbers(query: string): string[] {
  const sections = query.match(/\b(\d+[A-Z]*)\b/g) || [];
  const broadened: string[] = [];
  for (const sec of sections) {
    // Strip trailing letters one at a time: 15CG → 15C → 15
    let s = sec;
    while (s.length > 0 && /[A-Z]$/.test(s)) {
      s = s.slice(0, -1);
      if (s.length > 0) broadened.push(s);
    }
  }
  return broadened;
}

export function retrieveContext(query: string, topK = 3): string | null {
  let chunks = retrieve(allChunks, query, topK);

  // If poor results, try broadening section numbers (15CG → 15C → 15)
  if (chunks.length === 0) {
    const broader = broadenSectionNumbers(query);
    for (const broadSection of broader) {
      // Replace the original section number in query with broader version
      const broadQuery = query + ` section ${broadSection}`;
      chunks = retrieve(allChunks, broadQuery, topK);
      if (chunks.length > 0) break;
    }
  }

  if (chunks.length === 0) return null;

  const context = chunks
    .map(c => {
      const label = c.source === 'comparison' ? 'Comparison Guide' : c.source === 'act-2025' ? 'IT Act 2025' : 'IT Act 1961';
      return `[${label} — ${c.section}]\n${c.text}`;
    })
    .join('\n\n---\n\n');

  return context;
}
