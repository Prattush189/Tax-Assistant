import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──

interface SourceConfig {
  id: string;
  filePath: string;
  label: string;
  splitter: 'act' | 'comparison' | 'reference';
  boost?: number;
  disabled?: boolean;  // skip loading and indexing if true
  pdfFile?: string;
  pdfFiles?: { label: string; file: string }[];
}

interface Chunk {
  id: number;
  source: string; // valid values come from SOURCE_CONFIGS.id
  section: string;
  text: string;
  lowerText: string; // pre-computed for scoring
}

// ── Source registry ──

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    id: 'comparison', filePath: 'comparison.txt', label: 'Comparison Guide', splitter: 'comparison', boost: 0.7,
    pdfFiles: [
      { label: 'IT Act 2025', file: 'Income Tax Acts/Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf' },
      { label: 'IT Act 1961', file: 'Income Tax Acts/Income_Tax_Act_1961_as_amended_by_FA_Act_2026.pdf' },
    ],
  },
  { id: 'act-2025', filePath: 'act-2025.txt', label: 'IT Act 2025', splitter: 'act', pdfFile: 'Income Tax Acts/Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf' },
  { id: 'act-1961', filePath: 'act-1961.txt', label: 'IT Act 1961', splitter: 'act', pdfFile: 'Income Tax Acts/Income_Tax_Act_1961_as_amended_by_FA_Act_2026.pdf' },
  { id: 'cgst-2017', filePath: 'cgst-act.txt', label: 'CGST Act 2017', splitter: 'act', pdfFile: 'GST Acts/annexure-3_cgst-act_2017.pdf' },
  { id: 'igst-2017', filePath: 'igst-act.txt', label: 'IGST Act 2017', splitter: 'act', pdfFile: 'GST Acts/annexure-5-igst-act_2017.pdf' },
  { id: 'reference', filePath: 'reference-data.txt', label: 'Tax Reference Guide', splitter: 'reference', boost: 1.5 },
  { id: 'gst-changes-2025', filePath: 'GST Acts/gst_changes_2025.txt', label: 'GST Changes 2025', splitter: 'comparison', boost: 1.3, pdfFile: 'GST Acts/2025/GST rates2025.pdf' },

  // GST Amendments (disabled — secondary sources; re-enable in future versions if needed)
  { id: 'cgst-amend-2018', filePath: 'GST Acts/cgst_amendment_2018_raw.txt', label: 'CGST Amendment 2018', splitter: 'act', disabled: true, pdfFile: 'GST Acts/annexure-3_cgst-amendment-act_2018.pdf' },
  { id: 'cgst-amend-2023', filePath: 'GST Acts/cgst_amendment_2023_raw.txt', label: 'CGST Amendment 2023', splitter: 'act', disabled: true, pdfFile: 'GST Acts/cgst_ammendment_act_2023.pdf' },
  { id: 'igst-amend-2018', filePath: 'GST Acts/igst_amendment_2018_raw.txt', label: 'IGST Amendment 2018', splitter: 'act', disabled: true, pdfFile: 'GST Acts/annexure-5-igst-amendment-act_2018_1.pdf' },
  { id: 'cgst-jk-2017', filePath: 'GST Acts/cgst_jk_extension_raw.txt', label: 'CGST J&K Extension 2017', splitter: 'act', disabled: true, pdfFile: 'GST Acts/annexure-3_cgst-extension-to-jammu-and-kashmir-act_2017.pdf' },

  // UTGST (disabled — secondary sources; re-enable in future versions if needed)
  { id: 'utgst-2017', filePath: 'GST Acts/utgst_raw.txt', label: 'UTGST Act 2017', splitter: 'act', disabled: true, pdfFile: 'GST Acts/anneure_6_utgst-act_2017.pdf' },
  { id: 'utgst-amend-2018', filePath: 'GST Acts/utgst_amendment_2018_raw.txt', label: 'UTGST Amendment 2018', splitter: 'act', disabled: true, pdfFile: 'GST Acts/annexure-6-utgst-amendment-act_2018.pdf' },

  // SGSTs (disabled — state acts crowd out CGST/IGST; re-enable in future versions if needed)
  { id: 'sgst-delhi', filePath: 'GST Acts/delhi_sgst_raw.txt', label: 'Delhi SGST', splitter: 'act', disabled: true, pdfFile: 'GST Acts/delhi-sgst.pdf' },
  { id: 'sgst-haryana', filePath: 'GST Acts/haryana_sgst_raw.txt', label: 'Haryana SGST', splitter: 'act', disabled: true, pdfFile: 'GST Acts/haryana-sgst.pdf' },
  { id: 'sgst-himachal', filePath: 'GST Acts/hp_sgst_raw.txt', label: 'Himachal Pradesh SGST', splitter: 'act', disabled: true, pdfFile: 'GST Acts/himachal-pradesh-sgst.pdf' },
  { id: 'sgst-madhya', filePath: 'GST Acts/mp_sgst_raw.txt', label: 'Madhya Pradesh SGST', splitter: 'act', disabled: true, pdfFile: 'GST Acts/madhya-pradesh-sgst.pdf' },
  { id: 'sgst-punjab', filePath: 'GST Acts/punjab_sgst_raw.txt', label: 'Punjab SGST', splitter: 'act', disabled: true, pdfFile: 'GST Acts/punjab-sgst.pdf' },
  { id: 'sgst-jk', filePath: 'GST Acts/jk_sgst_raw.txt', label: 'J&K SGST', splitter: 'act', disabled: true, pdfFile: 'GST Acts/jammu-and-kashmir-sgst.pdf' },

  // Finance Acts (disabled — slot waste for core queries; re-enable in future versions if needed)
  { id: 'fa-2019', filePath: 'GST Acts/fa_2019_raw.txt', label: 'Finance Act 2019', splitter: 'act', disabled: true, pdfFile: 'GST Acts/finance_act_2019.pdf' },
  { id: 'fa-2020', filePath: 'GST Acts/fa_2020_raw.txt', label: 'Finance Act 2020', splitter: 'act', disabled: true, pdfFile: 'GST Acts/finance_act_2020.pdf' },
  { id: 'fa-2021', filePath: 'GST Acts/fa_2021_raw.txt', label: 'Finance Act 2021', splitter: 'act', disabled: true, pdfFile: 'GST Acts/finance_act_2021.pdf' },
  { id: 'fa-2022', filePath: 'GST Acts/fa_2022_raw.txt', label: 'Finance Act 2022', splitter: 'act', disabled: true, pdfFile: 'GST Acts/finance_act_of_2022.pdf' },
  { id: 'fa-2023', filePath: 'GST Acts/fa_2023_raw.txt', label: 'Finance Act 2023', splitter: 'act', disabled: true, pdfFile: 'GST Acts/finance_act_of_2023.pdf' },
];

const sourceConfigMap = new Map<string, SourceConfig>(
  SOURCE_CONFIGS.map(cfg => [cfg.id, cfg])
);

// ── Query routing ──

const SOURCE_GROUPS = {
  IT_PRIMARY: ['act-2025'],
  IT_OLD: ['act-1961'],
  CGST: ['cgst-2017', 'cgst-amend-2018', 'cgst-amend-2023', 'gst-changes-2025'],
  IGST: ['igst-2017', 'igst-amend-2018', 'gst-changes-2025'],
  SGST: ['sgst-delhi', 'sgst-haryana', 'sgst-himachal', 'sgst-punjab', 'sgst-jk',
         'utgst-2017', 'utgst-amend-2018', 'cgst-jk-2017'],
  GST_ALL: ['cgst-2017', 'igst-2017', 'gst-changes-2025', 'cgst-amend-2018',
            'cgst-amend-2023', 'igst-amend-2018'],
  FINANCE: ['fa-2019', 'fa-2020', 'fa-2021', 'fa-2022', 'fa-2023'],
};

interface ClassificationResult {
  primary: string[];
  fallback: string[];
}

function classifyQuery(query: string): ClassificationResult {
  const q = query.toLowerCase();

  // Rule 1: CGST specific
  if (/\bcgst\b|central goods and services/i.test(q)) {
    return { primary: SOURCE_GROUPS.CGST, fallback: ['reference'] };
  }
  // Rule 2: IGST specific
  if (/\bigst\b|integrated goods and services/i.test(q)) {
    return { primary: SOURCE_GROUPS.IGST, fallback: ['reference'] };
  }
  // Rule 3: SGST / UTGST specific
  if (/\bsgst\b|\butgst\b|state goods and services/i.test(q)) {
    return { primary: SOURCE_GROUPS.SGST, fallback: ['cgst-2017', 'reference'] };
  }
  // Rule 4: GST general
  if (/\bgst\b|goods and services tax/i.test(q)) {
    return { primary: SOURCE_GROUPS.GST_ALL, fallback: ['reference'] };
  }
  // Rule 5: Finance Act
  if (/\bfinance act\b|\bfinance bill\b/i.test(q)) {
    return { primary: SOURCE_GROUPS.FINANCE, fallback: ['reference'] };
  }
  // Rule 6: Due dates / compliance / reference data
  if (/\bdue date\b|\bdeadline\b|\bfiling date\b|\bcii\b|\bcost inflation\b|\bitr form\b/i.test(q)) {
    return { primary: ['reference'], fallback: SOURCE_GROUPS.IT_PRIMARY };
  }
  // Rule 7: Comparison / old vs new
  if (/\bcompar(e|ison)\b|\bold vs new\b|\b1961 vs 2025\b|\bmapping\b|\bold act\b|\bnew act\b/i.test(q)) {
    return { primary: ['comparison', ...SOURCE_GROUPS.IT_PRIMARY, ...SOURCE_GROUPS.IT_OLD], fallback: ['reference'] };
  }
  // Rule 8: Income tax (default IT route)
  if (/\bincome tax\b|\bit act\b|\btds\b|\btcs\b|\bcapital gain\b|\bdeduction\b|\b80[a-z]\b|\bsalary\b|\bexemption\b|\bassessment year\b|\btax year\b|\bitr\b|\bregime\b|\badvance tax\b|\bpenalty\b|\bsection\s+\d+[a-z]*|\bslab\b|\btax slab\b|\bhra\b|\b115bac\b/i.test(q)) {
    return { primary: SOURCE_GROUPS.IT_PRIMARY, fallback: [...SOURCE_GROUPS.IT_OLD, 'comparison', 'reference'] };
  }
  // Rule 9: No match — search all
  const allSources = SOURCE_CONFIGS.filter(c => !c.disabled).map(c => c.id);
  return { primary: allSources, fallback: [] };
}

// ── topK default ──

const DEFAULT_TOP_K = 3;

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

// ── Section-based text splitter (used as helper by splitActWithChaptersAndSchedules) ──

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

// ── Schedule boundary regexes (cover both Act file formats) ──

// act-2025.txt: "SCHEDULE I", "SCHEDULE II" ... "SCHEDULE XVI"
// act-1961.txt: "THE FIRST SCHEDULE", "THE SECOND SCHEDULE" ...
const SCHEDULE_BOUNDARY_REGEX = /^(?:SCHEDULE\s+[IVXLC]+|THE\s+\w+\s+SCHEDULE)\s*$/m;

// Chapter header: "CHAPTER IV" or "CHAPTER XIX-C" — always alone on a line, no period
const CHAPTER_LINE_REGEX = /^(CHAPTER\s+[IVX]+(?:-[A-Z]+)?)\s*$/gm;

// ── Schedule-specific splitter (no section regex applied) ──

function splitScheduleArea(text: string): { section: string; text: string }[] {
  // Split on SCHEDULE and PART boundaries
  // Matches: "SCHEDULE I", "THE FIRST SCHEDULE", "PART A", "PART I", etc.
  const boundaryRegex = /^(?:(?:THE\s+\w+\s+)?SCHEDULE\s*[IVXLC]*|SCHEDULE\s+[IVXLC]+|PART\s+[A-Z]+)\s*$/gm;

  const boundaries: { label: string; index: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = boundaryRegex.exec(text)) !== null) {
    boundaries.push({ label: match[0].trim(), index: match.index });
  }

  if (boundaries.length === 0) {
    const trimmed = text.trim();
    if (trimmed.length >= 50) {
      return [{ section: 'Schedule', text: trimmed }];
    }
    return [];
  }

  const results: { section: string; text: string }[] = [];

  // Track context: current schedule name + current part name
  // IMPORTANT: always update currentSchedule even if the segment is too short to emit,
  // so that subsequent PART boundaries inherit the correct schedule name.
  let currentSchedule = '';
  let currentPart = '';

  for (let i = 0; i < boundaries.length; i++) {
    const { label, index } = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    const segmentText = text.slice(index, end).trim();

    // Update context based on boundary type (always, before the length check)
    const isPart = /^PART\s+[A-Z]+$/.test(label);
    if (!isPart) {
      // This is a SCHEDULE boundary — reset context
      currentSchedule = label
        .replace(/^THE\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      currentPart = '';
    } else {
      // This is a PART boundary — append to current schedule
      currentPart = label;
    }

    if (segmentText.length < 50) continue;

    // Build human-readable section label
    const sectionLabel = currentPart
      ? `${currentSchedule} -- ${currentPart}`
      : currentSchedule;

    results.push({ section: sectionLabel, text: segmentText });
  }

  return results;
}

// ── Chapter-aware Act body splitter ──
// Runs the section regex on the Act body only (never on schedule text).
// Tracks current chapter heading and annotates each section label.

function splitActBodyWithChapters(text: string): { section: string; text: string }[] {
  // Collect CHAPTER header positions and their titles
  const chapterMatches = [...text.matchAll(CHAPTER_LINE_REGEX)];
  const chapterBoundaries: { label: string; title: string; index: number }[] = [];

  for (const cm of chapterMatches) {
    const afterHeader = cm.index! + cm[0].length;
    // The next non-empty line after a CHAPTER header is the chapter title
    const remaining = text.slice(afterHeader);
    const titleMatch = remaining.match(/^\s*\n([^\n]+)/);
    let title = titleMatch ? titleMatch[1].trim() : '';
    // Truncate very long titles
    if (title.length > 60) {
      title = title.slice(0, 57) + '...';
    }
    chapterBoundaries.push({
      label: cm[1].trim(),
      title,
      index: cm.index!,
    });
  }

  // Get raw sections (section regex only applied to actBody)
  const rawSections = splitIntoSections(text);

  // For each section, find which chapter it belongs to
  const sectionRegex = /^(\d+[A-Z]*(?:-[A-Z]+)?)\.\s/gm;
  const sectionMatches = [...text.matchAll(sectionRegex)];
  const sectionIndexMap = new Map<string, number>(); // section number → char index in text
  for (const sm of sectionMatches) {
    sectionIndexMap.set(sm[1], sm.index!);
  }

  function getChapterForIndex(charIndex: number): { label: string; title: string } | null {
    let current: { label: string; title: string } | null = null;
    for (const cb of chapterBoundaries) {
      if (cb.index <= charIndex) {
        current = { label: cb.label, title: cb.title };
      } else {
        break;
      }
    }
    return current;
  }

  const results: { section: string; text: string }[] = [];

  for (const sec of rawSections) {
    const charIndex = sectionIndexMap.get(sec.section);
    if (charIndex === undefined) {
      // Fallback: no positional info (shouldn't happen for normal sections)
      results.push(sec);
      continue;
    }

    const chapter = getChapterForIndex(charIndex);
    if (chapter) {
      const chapterLabel = chapter.title
        ? `${chapter.label} \u2014 ${chapter.title}`
        : chapter.label;
      results.push({
        section: `${sec.section} [${chapterLabel}]`,
        text: sec.text,
      });
    } else {
      // Before any CHAPTER header — preamble/preliminary sections
      results.push(sec);
    }
  }

  return results;
}

// ── Main Act splitter: chapter-aware + schedule-aware ──

function splitActWithChaptersAndSchedules(text: string): { section: string; text: string }[] {
  // Step 1: Find the first schedule boundary
  const scheduleMatch = SCHEDULE_BOUNDARY_REGEX.exec(text);
  const scheduleStartIndex = scheduleMatch ? scheduleMatch.index : text.length;

  const actBody = text.slice(0, scheduleStartIndex);
  const scheduleBody = text.slice(scheduleStartIndex);

  // Step 2: Process Act body with chapter context
  const actSections = splitActBodyWithChapters(actBody);

  // Step 3: Process schedule area (no section regex)
  const scheduleSections = scheduleBody.trim() ? splitScheduleArea(scheduleBody) : [];

  return [...actSections, ...scheduleSections];
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

// ── Stable chunk Map (globally monotonic IDs) ──

const chunkMap = new Map<number, Chunk>();
let nextChunkId = 0;

// ── Build chunks from a source config ──

function buildChunks(filePath: string, config: SourceConfig): Chunk[] {
  const text = readFileSync(filePath, 'utf-8');

  let rawSections: { section: string; text: string }[];
  if (config.splitter === 'comparison') {
    rawSections = splitComparisonSections(text);
  } else if (config.splitter === 'act') {
    rawSections = splitActWithChaptersAndSchedules(text);
  } else if (config.splitter === 'reference') {
    // Reference data uses same ====== delimiter format as comparison
    rawSections = splitComparisonSections(text);
  } else {
    throw new Error(`Splitter '${config.splitter}' is not implemented yet`);
  }

  const chunks: Chunk[] = [];

  for (const sec of rawSections) {
    const subChunks = subChunk(sec.text, sec.section);
    for (const sc of subChunks) {
      const chunk: Chunk = {
        id: nextChunkId++,
        source: config.id,
        section: sc.section,
        text: sc.text,
        lowerText: sc.text.toLowerCase(),
      };
      chunks.push(chunk);
      chunkMap.set(chunk.id, chunk);
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

  // Apply boost from source config (replaces hardcoded comparison check)
  const cfg = sourceConfigMap.get(chunk.source);
  if (cfg?.boost && score > 0) {
    score = Math.ceil(score * cfg.boost);
  }

  return score;
}

// ── Scored chunk type ──

interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

// ── Retrieve top chunks using inverted index ──

function retrieve(query: string, topK = DEFAULT_TOP_K, sourceFilter?: Set<string>): Chunk[] {
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

  // Look up chunks from the stable chunkMap, apply source filter
  const candidates = [...candidateIds]
    .map(id => chunkMap.get(id))
    .filter((c): c is Chunk => c !== undefined && (!sourceFilter || sourceFilter.has(c.source)));

  const scored = candidates
    .map(chunk => ({ chunk, score: scoreChunk(chunk, tokens, sectionNumbers) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score < 2) return [];

  // Dynamic bucket balancing — works with any number of active sources
  const buckets = new Map<string, ScoredChunk[]>();
  for (const cfg of SOURCE_CONFIGS) {
    if (!cfg.disabled && (!sourceFilter || sourceFilter.has(cfg.id))) {
      buckets.set(cfg.id, []);
    }
  }

  // First pass — guarantee one slot per source (if available)
  let guaranteedCount = 0;
  for (const s of scored) {
    const bucket = buckets.get(s.chunk.source);
    if (bucket && bucket.length < 1) {
      bucket.push(s);
      guaranteedCount++;
      if (guaranteedCount >= topK) break;
    }
  }

  // Collect guaranteed entries
  const combined: ScoredChunk[] = [];
  for (const bucket of buckets.values()) {
    combined.push(...bucket);
  }

  // Second pass — fill remaining slots from highest-scoring unused chunks
  const usedIds = new Set(combined.map(s => s.chunk.id));
  for (const s of scored) {
    if (combined.length >= topK) break;
    if (!usedIds.has(s.chunk.id)) {
      combined.push(s);
      usedIds.add(s.chunk.id);
    }
  }

  return combined
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.chunk);
}

// ── Initialize at startup ──

let allChunks: Chunk[] = [];

export function initRAG(): void {
  const dataDir = join(__dirname, '..', 'data');

  // Reset state for clean re-initialization
  allChunks = [];
  chunkMap.clear();
  invertedIndex.clear();
  nextChunkId = 0;

  for (const cfg of SOURCE_CONFIGS) {
    if (cfg.disabled) {
      console.log(`[RAG] Skipping disabled source: ${cfg.id}`);
      continue;
    }
    try {
      const chunks = buildChunks(join(dataDir, cfg.filePath), cfg);
      console.log(`[RAG] Loaded ${cfg.id}: ${chunks.length} chunks`);
      allChunks.push(...chunks);
    } catch {
      console.warn(`[RAG] ${cfg.filePath} not found, skipping`);
    }
  }

  // Build inverted index for fast lookup
  buildIndex(allChunks);
  console.log(`[RAG] Total chunks: ${chunkMap.size}, index keys: ${invertedIndex.size}`);
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

export interface SectionReference {
  source: string;
  section: string;
  label: string;
  text: string;
  pdfFile?: string;
  pdfFiles?: { label: string; file: string }[];
}

export interface RetrievalResult {
  context: string;
  references: SectionReference[];
}

function doRetrieve(query: string, topK: number): Chunk[] {
  const { primary, fallback } = classifyQuery(query);
  const primarySet = new Set(primary);

  // Phase 1: Search primary sources
  let chunks = retrieve(query, topK, primarySet);

  // Phase 2: Fill remaining slots from fallback sources
  if (chunks.length < topK && fallback.length > 0) {
    const fallbackSet = new Set(fallback);
    const usedIds = new Set(chunks.map(c => c.id));
    const extra = retrieve(query, topK - chunks.length, fallbackSet)
      .filter(c => !usedIds.has(c.id));
    chunks = [...chunks, ...extra].slice(0, topK);
  }

  // Phase 3: If still empty, try broadening section numbers (15CG → 15C → 15)
  if (chunks.length === 0) {
    const broader = broadenSectionNumbers(query);
    for (const broadSection of broader) {
      const broadQuery = query + ` section ${broadSection}`;
      chunks = retrieve(broadQuery, topK, primarySet);
      if (chunks.length > 0) break;
    }
  }
  return chunks;
}

export function retrieveContext(query: string, topK = DEFAULT_TOP_K): string | null {
  const chunks = doRetrieve(query, topK);
  if (chunks.length === 0) return null;

  return chunks
    .map(c => {
      const cfg = sourceConfigMap.get(c.source);
      const label = cfg?.label ?? c.source;
      return `[${label} \u2014 ${c.section}]\n${c.text}`;
    })
    .join('\n\n---\n\n');
}

export function retrieveContextWithRefs(query: string, topK = DEFAULT_TOP_K): RetrievalResult | null {
  const chunks = doRetrieve(query, topK);
  if (chunks.length === 0) return null;

  const context = chunks
    .map(c => {
      const cfg = sourceConfigMap.get(c.source);
      const label = cfg?.label ?? c.source;
      return `[${label} \u2014 ${c.section}]\n${c.text}`;
    })
    .join('\n\n---\n\n');

  const references: SectionReference[] = chunks.map(c => {
    const cfg = sourceConfigMap.get(c.source);
    const ref: SectionReference = {
      source: c.source,
      section: c.section,
      label: cfg?.label ?? c.source,
      text: c.text,
    };
    if (cfg?.pdfFile) ref.pdfFile = cfg.pdfFile;
    // For comparison source: only attach IT Act PDFs if the chunk is about IT, not GST
    if (cfg?.pdfFiles) {
      const isGstChunk = /\bGST\b|\bCGST\b|\bSGST\b|\bIGST\b|\bUTGST\b/i.test(c.text);
      if (!isGstChunk) ref.pdfFiles = cfg.pdfFiles;
    }
    return ref;
  });

  return { context, references };
}
