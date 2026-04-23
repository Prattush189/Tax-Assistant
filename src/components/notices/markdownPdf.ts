/**
 * Lightweight Markdown → jsPDF renderer for notice replies.
 *
 * Supports the subset of GFM that Claude produces for tax-notice drafts:
 *   - `## Heading` (large bold, colored, with underline bar)
 *   - `### Heading` (medium bold)
 *   - `**bold**` inline (including across wrapped lines)
 *   - `> quote` blockquotes (left border + tinted background)
 *   - `| col | col |` GFM tables (header row shaded)
 *   - `1.` / `-` lists with wrapping and indent
 *   - `---` horizontal rules
 *   - paragraphs with word-wrapping
 *
 * Intentionally does not bring in a heavyweight markdown parser — the PDF
 * layout constraints are narrow enough that a block-level regex-driven
 * walker is more maintainable.
 */

import type { jsPDF } from 'jspdf';

export interface MarkdownPdfOptions {
  margin: number;
  pageWidthMm: number;
  pageHeightMm: number;
  startY: number;
  /** Called after each auto-page-break. Must repaint header/watermark and return the new top-of-content Y. */
  onPageBreak: () => Promise<number>;
}

const FONT_BODY = 'times';
const FONT_HEADING = 'helvetica';
const BODY_SIZE = 11;
const LINE_HEIGHT = 5.5;
const PARAGRAPH_GAP = 2.5;

// Dark navy used for headings and table headers — matches the sample reply.
const HEADING_RGB: [number, number, number] = [30, 58, 138];

/**
 * Split an inline markdown string into segments of { text, bold }.
 * Handles `**bold**` markers; ignores single-asterisk emphasis to keep the
 * output letter-like rather than italicised.
 */
function splitInlineBold(input: string): Array<{ text: string; bold: boolean }> {
  const segments: Array<{ text: string; bold: boolean }> = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ text: input.slice(lastIdx, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < input.length) {
    segments.push({ text: input.slice(lastIdx), bold: false });
  }
  return segments.length > 0 ? segments : [{ text: input, bold: false }];
}

function stripInlineMarkdown(input: string): string {
  return input.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

interface RenderState {
  doc: jsPDF;
  opts: MarkdownPdfOptions;
  y: number;
  usableWidth: number;
}

async function ensureSpace(state: RenderState, needed: number): Promise<void> {
  if (state.y + needed > state.opts.pageHeightMm - state.opts.margin) {
    state.doc.addPage();
    state.y = await state.opts.onPageBreak();
  }
}

/** Render a paragraph that may contain **bold** runs. Wraps across lines. */
async function drawParagraph(state: RenderState, text: string): Promise<void> {
  const { doc, opts } = state;
  const segments = splitInlineBold(text);

  doc.setFont(FONT_BODY, 'normal');
  doc.setFontSize(BODY_SIZE);
  doc.setTextColor(20, 20, 20);

  let x = opts.margin;
  const right = opts.margin + state.usableWidth;

  const spaceWidth = doc.getTextWidth(' ');

  const tokens: Array<{ text: string; bold: boolean }> = [];
  for (const seg of segments) {
    const parts = seg.text.split(/(\s+)/);
    for (const p of parts) {
      if (!p) continue;
      tokens.push({ text: p, bold: seg.bold });
    }
  }

  await ensureSpace(state, LINE_HEIGHT);

  for (const tok of tokens) {
    doc.setFont(FONT_BODY, tok.bold ? 'bold' : 'normal');
    const width = tok.text === ' ' ? spaceWidth : doc.getTextWidth(tok.text);

    if (/^\s+$/.test(tok.text)) {
      if (x + width > right) {
        x = opts.margin;
        state.y += LINE_HEIGHT;
        await ensureSpace(state, LINE_HEIGHT);
      } else {
        x += width;
      }
      continue;
    }

    if (x + width > right && x > opts.margin) {
      x = opts.margin;
      state.y += LINE_HEIGHT;
      await ensureSpace(state, LINE_HEIGHT);
    }

    // Word longer than the line: just draw it — jsPDF handles overflow visually.
    doc.text(tok.text, x, state.y);
    x += width;
  }

  state.y += LINE_HEIGHT + PARAGRAPH_GAP;
}

async function drawHeading(state: RenderState, level: 1 | 2 | 3, text: string): Promise<void> {
  const { doc, opts } = state;
  const size = level === 1 ? 16 : level === 2 ? 13 : 11.5;
  const gap = level === 1 ? 5 : 3.5;

  await ensureSpace(state, size * 0.55 + gap);
  state.y += gap;

  doc.setFont(FONT_HEADING, 'bold');
  doc.setFontSize(size);
  doc.setTextColor(HEADING_RGB[0], HEADING_RGB[1], HEADING_RGB[2]);
  const clean = stripInlineMarkdown(text);
  const wrapped = doc.splitTextToSize(clean, state.usableWidth);
  for (const line of wrapped) {
    await ensureSpace(state, size * 0.55 + 1);
    doc.text(line, opts.margin, state.y);
    state.y += size * 0.55 + 1;
  }

  if (level === 2) {
    doc.setDrawColor(HEADING_RGB[0], HEADING_RGB[1], HEADING_RGB[2]);
    doc.setLineWidth(0.3);
    doc.line(opts.margin, state.y - 0.5, opts.margin + state.usableWidth, state.y - 0.5);
  }
  state.y += gap;
  doc.setTextColor(20, 20, 20);
}

async function drawBlockquote(state: RenderState, text: string): Promise<void> {
  const { doc, opts } = state;
  const pad = 4;
  const boxWidth = state.usableWidth;
  const innerWidth = boxWidth - pad * 2;

  doc.setFont(FONT_BODY, 'italic');
  doc.setFontSize(BODY_SIZE);
  const clean = stripInlineMarkdown(text);
  const wrapped = doc.splitTextToSize(clean, innerWidth);
  const blockHeight = wrapped.length * LINE_HEIGHT + pad;

  await ensureSpace(state, blockHeight + 2);

  // Tinted background + left border bar
  doc.setFillColor(235, 240, 252);
  doc.rect(opts.margin, state.y - LINE_HEIGHT + 1, boxWidth, blockHeight, 'F');
  doc.setDrawColor(HEADING_RGB[0], HEADING_RGB[1], HEADING_RGB[2]);
  doc.setLineWidth(0.8);
  doc.line(opts.margin, state.y - LINE_HEIGHT + 1, opts.margin, state.y - LINE_HEIGHT + 1 + blockHeight);

  doc.setTextColor(40, 40, 60);
  let ty = state.y;
  for (const line of wrapped) {
    doc.text(line, opts.margin + pad, ty);
    ty += LINE_HEIGHT;
  }
  state.y = ty + PARAGRAPH_GAP;
  doc.setTextColor(20, 20, 20);
  doc.setFont(FONT_BODY, 'normal');
}

async function drawHr(state: RenderState): Promise<void> {
  const { doc, opts } = state;
  await ensureSpace(state, 4);
  state.y += 2;
  doc.setDrawColor(170, 170, 170);
  doc.setLineWidth(0.3);
  doc.line(opts.margin, state.y, opts.margin + state.usableWidth, state.y);
  state.y += 4;
}

interface ListItem { marker: string; text: string; }

async function drawList(state: RenderState, items: ListItem[]): Promise<void> {
  const { doc, opts } = state;
  doc.setFont(FONT_BODY, 'normal');
  doc.setFontSize(BODY_SIZE);
  doc.setTextColor(20, 20, 20);

  const markerWidth = 7;
  const textWidth = state.usableWidth - markerWidth;

  for (const item of items) {
    await ensureSpace(state, LINE_HEIGHT);
    doc.setFont(FONT_BODY, 'bold');
    doc.text(item.marker, opts.margin, state.y);

    const segments = splitInlineBold(item.text);
    const tokens: Array<{ text: string; bold: boolean }> = [];
    for (const seg of segments) {
      const parts = seg.text.split(/(\s+)/);
      for (const p of parts) if (p) tokens.push({ text: p, bold: seg.bold });
    }

    let x = opts.margin + markerWidth;
    const right = opts.margin + markerWidth + textWidth;
    const spaceWidth = doc.getTextWidth(' ');

    for (const tok of tokens) {
      doc.setFont(FONT_BODY, tok.bold ? 'bold' : 'normal');
      const width = tok.text === ' ' ? spaceWidth : doc.getTextWidth(tok.text);
      if (/^\s+$/.test(tok.text)) {
        if (x + width > right) {
          x = opts.margin + markerWidth;
          state.y += LINE_HEIGHT;
          await ensureSpace(state, LINE_HEIGHT);
        } else {
          x += width;
        }
        continue;
      }
      if (x + width > right && x > opts.margin + markerWidth) {
        x = opts.margin + markerWidth;
        state.y += LINE_HEIGHT;
        await ensureSpace(state, LINE_HEIGHT);
      }
      doc.text(tok.text, x, state.y);
      x += width;
    }
    state.y += LINE_HEIGHT;
  }
  state.y += PARAGRAPH_GAP;
}

async function drawTable(state: RenderState, rows: string[][], hasHeader: boolean): Promise<void> {
  const { doc, opts } = state;
  if (rows.length === 0) return;

  const colCount = Math.max(...rows.map(r => r.length));
  const colWidth = state.usableWidth / colCount;
  const cellPad = 1.5;

  doc.setFont(FONT_BODY, 'normal');
  doc.setFontSize(BODY_SIZE - 0.5);

  const wrappedRows: string[][][] = rows.map((row, rowIdx) =>
    row.map((cell) => {
      const clean = stripInlineMarkdown(cell.trim());
      doc.setFont(FONT_BODY, hasHeader && rowIdx === 0 ? 'bold' : 'normal');
      return doc.splitTextToSize(clean, colWidth - cellPad * 2);
    }),
  );
  const rowHeights = wrappedRows.map(row => {
    const maxLines = Math.max(...row.map(lines => lines.length));
    return maxLines * (LINE_HEIGHT - 0.5) + cellPad * 2;
  });

  for (let r = 0; r < rows.length; r++) {
    const height = rowHeights[r];
    await ensureSpace(state, height + 1);

    const isHeader = hasHeader && r === 0;
    if (isHeader) {
      doc.setFillColor(HEADING_RGB[0], HEADING_RGB[1], HEADING_RGB[2]);
      doc.rect(opts.margin, state.y - LINE_HEIGHT + 1, state.usableWidth, height, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont(FONT_BODY, 'bold');
    } else {
      if (r % 2 === 0) {
        doc.setFillColor(245, 247, 250);
        doc.rect(opts.margin, state.y - LINE_HEIGHT + 1, state.usableWidth, height, 'F');
      }
      doc.setTextColor(20, 20, 20);
      doc.setFont(FONT_BODY, 'normal');
    }

    // Cell borders
    doc.setDrawColor(200, 200, 210);
    doc.setLineWidth(0.15);
    for (let c = 0; c < colCount; c++) {
      const x = opts.margin + c * colWidth;
      doc.rect(x, state.y - LINE_HEIGHT + 1, colWidth, height);
      const lines = wrappedRows[r][c] ?? [''];
      let ty = state.y + cellPad - 1;
      for (const line of lines) {
        doc.text(line, x + cellPad, ty);
        ty += LINE_HEIGHT - 0.5;
      }
    }
    state.y += height;
  }
  state.y += PARAGRAPH_GAP;
  doc.setTextColor(20, 20, 20);
  doc.setFont(FONT_BODY, 'normal');
  doc.setFontSize(BODY_SIZE);
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'blockquote'; text: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'table'; rows: string[][]; hasHeader: boolean }
  | { kind: 'hr' };

/** Parse the markdown into a flat list of layout blocks. */
function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const paragraphBuf: string[] = [];
  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const joined = paragraphBuf.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) blocks.push({ kind: 'paragraph', text: joined });
    paragraphBuf.length = 0;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) { flushParagraph(); i++; continue; }

    // Horizontal rule
    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Headings
    const headMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headMatch) {
      flushParagraph();
      const level = headMatch[1].length as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: headMatch[2] });
      i++;
      continue;
    }

    // Blockquote — collect consecutive `>` lines
    if (line.startsWith('>')) {
      flushParagraph();
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'blockquote', text: buf.join(' ').replace(/\s+/g, ' ').trim() });
      continue;
    }

    // GFM table — first line has pipes, second is the separator `| --- | --- |`
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1].trim())) {
      flushParagraph();
      const rows: string[][] = [];
      // Header
      rows.push(splitTableRow(line));
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i].trim()));
        i++;
      }
      blocks.push({ kind: 'table', rows, hasHeader: true });
      continue;
    }

    // List — ordered (`1.`, `(i)`, `A.`) or unordered (`-`, `*`)
    const orderedMatch = /^(\d+\.|\([ivxlcdm]+\)|\([a-z]\)|[A-Z]\.)\s+(.*)$/i.exec(line);
    const unorderedMatch = /^[-*]\s+(.*)$/.exec(line);
    if (orderedMatch || unorderedMatch) {
      flushParagraph();
      const items: ListItem[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        const om = /^(\d+\.|\([ivxlcdm]+\)|\([a-z]\)|[A-Z]\.)\s+(.*)$/i.exec(l);
        const um = /^[-*]\s+(.*)$/.exec(l);
        if (om) {
          items.push({ marker: om[1], text: om[2] });
          i++;
        } else if (um) {
          items.push({ marker: '•', text: um[1] });
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    paragraphBuf.push(line);
    i++;
  }
  flushParagraph();
  return blocks;
}

function splitTableRow(line: string): string[] {
  // `| a | b | c |` → ['a', 'b', 'c']
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(s => s.trim());
}

/** Public entry point. */
export async function renderMarkdownToPdf(
  doc: jsPDF,
  markdown: string,
  opts: MarkdownPdfOptions,
): Promise<void> {
  const usableWidth = opts.pageWidthMm - opts.margin * 2;
  const state: RenderState = { doc, opts, y: opts.startY, usableWidth };

  doc.setFont(FONT_BODY, 'normal');
  doc.setFontSize(BODY_SIZE);
  doc.setTextColor(20, 20, 20);

  const blocks = parseBlocks(markdown);

  for (const block of blocks) {
    if (block.kind === 'heading') {
      await drawHeading(state, block.level, block.text);
    } else if (block.kind === 'paragraph') {
      await drawParagraph(state, block.text);
    } else if (block.kind === 'blockquote') {
      await drawBlockquote(state, block.text);
    } else if (block.kind === 'list') {
      await drawList(state, block.items);
    } else if (block.kind === 'table') {
      await drawTable(state, block.rows, block.hasHeader);
    } else if (block.kind === 'hr') {
      await drawHr(state);
    }
  }
}
