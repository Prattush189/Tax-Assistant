/**
 * Markdown → Word-compatible HTML converter (.doc download).
 *
 * Word opens HTML files with a .doc extension natively and renders
 * inline styles + tables + lists faithfully. This lets us emit a
 * Word document without pulling in the ~600KB `docx` npm package
 * just for tax-notice replies. The trade-off vs. real .docx is no
 * native pagination — but Word repaginates on open, and the user's
 * letterhead is applied via the existing PDF path anyway.
 *
 * Supports the same markdown subset the PDF renderer does:
 * headings (h1-h3), paragraphs, blockquotes, **bold** inline,
 * unordered + ordered lists, tables (first row = header), and `---`
 * horizontal rules. Anything outside this set falls back to plain
 * paragraph text — no HTML injection because all user text is
 * escaped before interpolation.
 */

interface ListItem { marker: string; text: string; }
type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'blockquote'; text: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'table'; rows: string[][]; hasHeader: boolean }
  | { kind: 'hr' };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert **bold** spans to <b>…</b>, escaping everything else. */
function inlineToHtml(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const next = text.indexOf('**', i);
    if (next === -1) { out.push(escapeHtml(text.slice(i))); break; }
    out.push(escapeHtml(text.slice(i, next)));
    const close = text.indexOf('**', next + 2);
    if (close === -1) { out.push(escapeHtml(text.slice(next))); break; }
    out.push('<b>', escapeHtml(text.slice(next + 2, close)), '</b>');
    i = close + 2;
  }
  return out.join('');
}

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

    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    const headMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headMatch) {
      flushParagraph();
      const level = headMatch[1].length as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: headMatch[2] });
      i++;
      continue;
    }

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

    // GFM-style table — at least one pipe-separated row followed by a
    // dash separator row.
    if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1].trim())) {
      flushParagraph();
      const rows: string[][] = [];
      // Header row
      rows.push(line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const t = lines[i].trim();
        rows.push(t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
        i++;
      }
      blocks.push({ kind: 'table', rows, hasHeader: true });
      continue;
    }

    // Lists — both ordered (1. , 2. ) and unordered (-, *, +).
    if (/^([-*+]\s+|\d+\.\s+)/.test(line)) {
      flushParagraph();
      const items: ListItem[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = /^([-*+]\s+|\d+\.\s+)(.*)$/.exec(t);
        if (!m) break;
        items.push({ marker: m[1].trim(), text: m[2] });
        i++;
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

function blockToHtml(b: Block): string {
  switch (b.kind) {
    case 'heading': {
      const tag = `h${b.level}`;
      // Word renders h1-h3 with sensible defaults but inlining the
      // sizes makes the output consistent across Word versions.
      const size = b.level === 1 ? '20pt' : b.level === 2 ? '16pt' : '13pt';
      return `<${tag} style="font-family:Calibri,Arial,sans-serif;font-size:${size};margin:14pt 0 6pt 0;">${inlineToHtml(b.text)}</${tag}>`;
    }
    case 'paragraph':
      return `<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;margin:0 0 8pt 0;">${inlineToHtml(b.text)}</p>`;
    case 'blockquote':
      return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;border-left:3pt solid #888;padding-left:10pt;color:#444;margin:6pt 0 8pt 0;">${inlineToHtml(b.text)}</div>`;
    case 'hr':
      return '<hr style="border:none;border-top:1pt solid #ccc;margin:12pt 0;" />';
    case 'list': {
      // Detect ordered vs. unordered from the first marker. Markdown
      // mixed lists are rare; collapsing to one tag keeps output simple.
      const ordered = /^\d+\.?$/.test(b.items[0]?.marker ?? '');
      const tag = ordered ? 'ol' : 'ul';
      const items = b.items.map(it => `<li style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4;margin:0 0 4pt 0;">${inlineToHtml(it.text)}</li>`).join('');
      return `<${tag} style="margin:0 0 8pt 18pt;">${items}</${tag}>`;
    }
    case 'table': {
      const cells = (cell: string, header: boolean) => {
        const tag = header ? 'th' : 'td';
        const bg = header ? 'background:#f0f0f0;font-weight:bold;' : '';
        return `<${tag} style="font-family:Calibri,Arial,sans-serif;font-size:10pt;border:0.5pt solid #999;padding:4pt 6pt;${bg}">${inlineToHtml(cell)}</${tag}>`;
      };
      const rows = b.rows.map((row, idx) => {
        const isHeader = idx === 0 && b.hasHeader;
        return `<tr>${row.map(c => cells(c, isHeader)).join('')}</tr>`;
      }).join('');
      return `<table style="border-collapse:collapse;margin:6pt 0 10pt 0;width:100%;">${rows}</table>`;
    }
  }
}

/**
 * Build a Word-compatible HTML document for the given markdown.
 * Wraps a body of converted blocks in the namespaced HTML Word
 * recognises so it opens cleanly in Word and Google Docs.
 */
export function markdownToWordHtml(markdown: string, title = 'Notice Reply'): string {
  const blocks = parseBlocks(markdown);
  const body = blocks.map(blockToHtml).join('\n');
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml>
<w:WordDocument>
  <w:View>Print</w:View>
  <w:Zoom>100</w:Zoom>
  <w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml><![endif]-->
<style>
@page { size: A4; margin: 20mm; }
body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #222; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Trigger a browser download of `markdown` as a .doc file. */
export function downloadAsWord(markdown: string, filename = 'notice-reply.doc'): void {
  const html = markdownToWordHtml(markdown);
  // application/msword tells the browser this should be saved as a
  // Word document. Older "applicaition/vnd.ms-word" mime works too
  // but msword is the most widely-recognised legacy alias.
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
