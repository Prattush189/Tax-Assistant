/**
 * One-time script to extract text from all Act PDFs using Claude API.
 * Run: npx tsx server/scripts/extract-pdf-text.ts
 *
 * Re-extracts existing text files and creates new ones for PDFs without text.
 * Backs up originals before overwriting.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── PDF → output text file mappings ──

interface PdfMapping {
  id: string;
  pdfPath: string;       // relative to DATA_DIR
  outputPath: string;    // relative to DATA_DIR
  label: string;
}

const MAPPINGS: PdfMapping[] = [
  // Income Tax Acts (re-extract existing)
  {
    id: 'act-2025',
    pdfPath: 'Income Tax Acts/Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf',
    outputPath: 'act-2025.txt',
    label: 'IT Act 2025',
  },
  {
    id: 'act-1961',
    pdfPath: 'Income Tax Acts/Income_Tax_Act_1961_as_amended_by_FA_Act_2026.pdf',
    outputPath: 'act-1961.txt',
    label: 'IT Act 1961',
  },

  // CGST / IGST (re-extract existing)
  {
    id: 'cgst-2017',
    pdfPath: 'GST Acts/annexure-3_cgst-act_2017.pdf',
    outputPath: 'cgst-act.txt',
    label: 'CGST Act 2017',
  },
  {
    id: 'igst-2017',
    pdfPath: 'GST Acts/annexure-5-igst-act_2017.pdf',
    outputPath: 'igst-act.txt',
    label: 'IGST Act 2017',
  },

  // GST Amendments (re-extract from PDFs)
  {
    id: 'cgst-amend-2018',
    pdfPath: 'GST Acts/annexure-3_cgst-amendment-act_2018.pdf',
    outputPath: 'GST Acts/cgst_amendment_2018_raw.txt',
    label: 'CGST Amendment 2018',
  },
  {
    id: 'cgst-amend-2023',
    pdfPath: 'GST Acts/cgst_ammendment_act_2023.pdf',
    outputPath: 'GST Acts/cgst_amendment_2023_raw.txt',
    label: 'CGST Amendment 2023',
  },
  {
    id: 'igst-amend-2018',
    pdfPath: 'GST Acts/annexure-5-igst-amendment-act_2018_1.pdf',
    outputPath: 'GST Acts/igst_amendment_2018_raw.txt',
    label: 'IGST Amendment 2018',
  },

  // UTGST
  {
    id: 'utgst-2017',
    pdfPath: 'GST Acts/anneure_6_utgst-act_2017.pdf',
    outputPath: 'GST Acts/utgst_raw.txt',
    label: 'UTGST Act 2017',
  },
  {
    id: 'utgst-amend-2018',
    pdfPath: 'GST Acts/annexure-6-utgst-amendment-act_2018.pdf',
    outputPath: 'GST Acts/utgst_amendment_2018_raw.txt',
    label: 'UTGST Amendment 2018',
  },

  // CGST J&K Extension
  {
    id: 'cgst-jk-2017',
    pdfPath: 'GST Acts/annexure-3_cgst-extension-to-jammu-and-kashmir-act_2017.pdf',
    outputPath: 'GST Acts/cgst_jk_extension_raw.txt',
    label: 'CGST J&K Extension 2017',
  },

  // SGSTs
  {
    id: 'sgst-delhi',
    pdfPath: 'GST Acts/delhi-sgst.pdf',
    outputPath: 'GST Acts/delhi_sgst_raw.txt',
    label: 'Delhi SGST',
  },
  {
    id: 'sgst-haryana',
    pdfPath: 'GST Acts/haryana-sgst.pdf',
    outputPath: 'GST Acts/haryana_sgst_raw.txt',
    label: 'Haryana SGST',
  },
  {
    id: 'sgst-himachal',
    pdfPath: 'GST Acts/himachal-pradesh-sgst.pdf',
    outputPath: 'GST Acts/hp_sgst_raw.txt',
    label: 'Himachal Pradesh SGST',
  },
  {
    id: 'sgst-madhya',
    pdfPath: 'GST Acts/madhya-pradesh-sgst.pdf',
    outputPath: 'GST Acts/mp_sgst_raw.txt',
    label: 'Madhya Pradesh SGST',
  },
  {
    id: 'sgst-punjab',
    pdfPath: 'GST Acts/punjab-sgst.pdf',
    outputPath: 'GST Acts/punjab_sgst_raw.txt',
    label: 'Punjab SGST',
  },
  {
    id: 'sgst-jk',
    pdfPath: 'GST Acts/jammu-and-kashmir-sgst.pdf',
    outputPath: 'GST Acts/jk_sgst_raw.txt',
    label: 'J&K SGST',
  },

  // Finance Acts
  {
    id: 'fa-2019',
    pdfPath: 'GST Acts/finance_act_2019.pdf',
    outputPath: 'GST Acts/fa_2019_raw.txt',
    label: 'Finance Act 2019',
  },
  {
    id: 'fa-2020',
    pdfPath: 'GST Acts/finance_act_2020.pdf',
    outputPath: 'GST Acts/fa_2020_raw.txt',
    label: 'Finance Act 2020',
  },
  {
    id: 'fa-2021',
    pdfPath: 'GST Acts/finance_act_2021.pdf',
    outputPath: 'GST Acts/fa_2021_raw.txt',
    label: 'Finance Act 2021',
  },
  {
    id: 'fa-2022',
    pdfPath: 'GST Acts/finance_act_of_2022.pdf',
    outputPath: 'GST Acts/fa_2022_raw.txt',
    label: 'Finance Act 2022',
  },
  {
    id: 'fa-2023',
    pdfPath: 'GST Acts/finance_act_of_2023.pdf',
    outputPath: 'GST Acts/fa_2023_raw.txt',
    label: 'Finance Act 2023',
  },
];

const EXTRACTION_PROMPT = `You are a precise legal document text extractor. Extract ALL text from this PDF document exactly as written.

Rules:
- Preserve the exact text, section numbers, headings, and structure
- Keep section numbers (e.g., "80C.", "2.", "CHAPTER IV") exactly as they appear
- Preserve paragraph structure with proper line breaks
- Remove page headers/footers, page numbers, and watermarks
- Remove any Hindi/Devanagari gazette notification text (jftLVªh, vlk/kkj.k, etc.)
- Do NOT summarize, skip, or paraphrase — extract the COMPLETE text
- Output plain text only, no markdown formatting
- If text spans multiple columns, read left to right, top to bottom`;

const MAX_PDF_SIZE = 25 * 1024 * 1024; // 25MB base64 limit for Claude API

async function extractText(pdfPath: string, label: string): Promise<string> {
  const fullPath = join(DATA_DIR, pdfPath);
  const stat = statSync(fullPath);
  const sizeKB = Math.round(stat.size / 1024);

  console.log(`  Reading ${pdfPath} (${sizeKB} KB)...`);

  if (stat.size > MAX_PDF_SIZE) {
    console.log(`  WARNING: File too large (${sizeKB} KB), may fail. Attempting anyway...`);
  }

  const buffer = readFileSync(fullPath);
  const base64 = buffer.toString('base64');

  console.log(`  Sending to Claude API...`);

  // Use streaming to handle long-running PDF extraction
  let extractedText = '';
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 64000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64,
          },
        },
        { type: 'text' as const, text: EXTRACTION_PROMPT },
      ],
    }],
  });

  stream.on('text', (text) => {
    extractedText += text;
  });

  const finalMessage = await stream.finalMessage();
  console.log(`  Extracted ${extractedText.length} chars (${finalMessage.usage.input_tokens} input tokens, ${finalMessage.usage.output_tokens} output tokens)`);
  return extractedText;
}

async function main() {
  console.log('=== PDF Text Extraction Script ===\n');
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Total PDFs to process: ${MAPPINGS.length}\n`);

  // Allow filtering by ID via command line args
  const filterIds = process.argv.slice(2);
  const toProcess = filterIds.length > 0
    ? MAPPINGS.filter(m => filterIds.includes(m.id))
    : MAPPINGS;

  if (filterIds.length > 0) {
    console.log(`Filtering to: ${filterIds.join(', ')}\n`);
  }

  const results: { id: string; status: string; chars?: number }[] = [];

  for (const mapping of toProcess) {
    const pdfFullPath = join(DATA_DIR, mapping.pdfPath);
    const outFullPath = join(DATA_DIR, mapping.outputPath);

    console.log(`[${mapping.id}] ${mapping.label}`);

    // Check PDF exists
    if (!existsSync(pdfFullPath)) {
      console.log(`  SKIP: PDF not found at ${mapping.pdfPath}\n`);
      results.push({ id: mapping.id, status: 'skipped - PDF missing' });
      continue;
    }

    // Backup existing output
    if (existsSync(outFullPath)) {
      const backupPath = outFullPath.replace('.txt', '.txt.bak');
      copyFileSync(outFullPath, backupPath);
      console.log(`  Backed up existing: ${mapping.outputPath} → .bak`);
    }

    try {
      const text = await extractText(mapping.pdfPath, mapping.label);
      writeFileSync(outFullPath, text, 'utf-8');
      console.log(`  Saved: ${mapping.outputPath} (${text.length} chars)\n`);
      results.push({ id: mapping.id, status: 'success', chars: text.length });
    } catch (err: any) {
      console.error(`  ERROR: ${err.message}\n`);
      results.push({ id: mapping.id, status: `error: ${err.message}` });
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const success = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status.startsWith('error'));
  const skipped = results.filter(r => r.status.startsWith('skipped'));

  console.log(`Success: ${success.length} | Failed: ${failed.length} | Skipped: ${skipped.length}`);

  if (failed.length > 0) {
    console.log('\nFailed:');
    failed.forEach(r => console.log(`  ${r.id}: ${r.status}`));
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
