/**
 * Extract text from all Act PDFs using pdfjs-dist (local, no API key needed).
 * Run: npx tsx server/scripts/extract-pdf-text.ts
 * Filter: npx tsx server/scripts/extract-pdf-text.ts act-2025 cgst-2017
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.mjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');

// ── PDF → output text file mappings ──

interface PdfMapping {
  id: string;
  pdfPath: string;
  outputPath: string;
  label: string;
}

const MAPPINGS: PdfMapping[] = [
  // Income Tax Acts
  { id: 'act-2025', pdfPath: 'Income Tax Acts/Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf', outputPath: 'act-2025.txt', label: 'IT Act 2025' },
  { id: 'act-1961', pdfPath: 'Income Tax Acts/Income_Tax_Act_1961_as_amended_by_FA_Act_2026.pdf', outputPath: 'act-1961.txt', label: 'IT Act 1961' },

  // CGST / IGST
  { id: 'cgst-2017', pdfPath: 'GST Acts/annexure-3_cgst-act_2017.pdf', outputPath: 'cgst-act.txt', label: 'CGST Act 2017' },
  { id: 'igst-2017', pdfPath: 'GST Acts/annexure-5-igst-act_2017.pdf', outputPath: 'igst-act.txt', label: 'IGST Act 2017' },

  // GST Amendments
  { id: 'cgst-amend-2018', pdfPath: 'GST Acts/annexure-3_cgst-amendment-act_2018.pdf', outputPath: 'GST Acts/cgst_amendment_2018_raw.txt', label: 'CGST Amendment 2018' },
  { id: 'cgst-amend-2023', pdfPath: 'GST Acts/cgst_ammendment_act_2023.pdf', outputPath: 'GST Acts/cgst_amendment_2023_raw.txt', label: 'CGST Amendment 2023' },
  { id: 'igst-amend-2018', pdfPath: 'GST Acts/annexure-5-igst-amendment-act_2018_1.pdf', outputPath: 'GST Acts/igst_amendment_2018_raw.txt', label: 'IGST Amendment 2018' },
  { id: 'cgst-jk-2017', pdfPath: 'GST Acts/annexure-3_cgst-extension-to-jammu-and-kashmir-act_2017.pdf', outputPath: 'GST Acts/cgst_jk_extension_raw.txt', label: 'CGST J&K Extension 2017' },

  // UTGST
  { id: 'utgst-2017', pdfPath: 'GST Acts/anneure_6_utgst-act_2017.pdf', outputPath: 'GST Acts/utgst_raw.txt', label: 'UTGST Act 2017' },
  { id: 'utgst-amend-2018', pdfPath: 'GST Acts/annexure-6-utgst-amendment-act_2018.pdf', outputPath: 'GST Acts/utgst_amendment_2018_raw.txt', label: 'UTGST Amendment 2018' },

  // SGSTs
  { id: 'sgst-delhi', pdfPath: 'GST Acts/delhi-sgst.pdf', outputPath: 'GST Acts/delhi_sgst_raw.txt', label: 'Delhi SGST' },
  { id: 'sgst-haryana', pdfPath: 'GST Acts/haryana-sgst.pdf', outputPath: 'GST Acts/haryana_sgst_raw.txt', label: 'Haryana SGST' },
  { id: 'sgst-himachal', pdfPath: 'GST Acts/himachal-pradesh-sgst.pdf', outputPath: 'GST Acts/hp_sgst_raw.txt', label: 'Himachal Pradesh SGST' },
  { id: 'sgst-madhya', pdfPath: 'GST Acts/madhya-pradesh-sgst.pdf', outputPath: 'GST Acts/mp_sgst_raw.txt', label: 'Madhya Pradesh SGST' },
  { id: 'sgst-punjab', pdfPath: 'GST Acts/punjab-sgst.pdf', outputPath: 'GST Acts/punjab_sgst_raw.txt', label: 'Punjab SGST' },
  { id: 'sgst-jk', pdfPath: 'GST Acts/jammu-and-kashmir-sgst.pdf', outputPath: 'GST Acts/jk_sgst_raw.txt', label: 'J&K SGST' },

  // Finance Acts
  { id: 'fa-2019', pdfPath: 'GST Acts/finance_act_2019.pdf', outputPath: 'GST Acts/fa_2019_raw.txt', label: 'Finance Act 2019' },
  { id: 'fa-2020', pdfPath: 'GST Acts/finance_act_2020.pdf', outputPath: 'GST Acts/fa_2020_raw.txt', label: 'Finance Act 2020' },
  { id: 'fa-2021', pdfPath: 'GST Acts/finance_act_2021.pdf', outputPath: 'GST Acts/fa_2021_raw.txt', label: 'Finance Act 2021' },
  { id: 'fa-2022', pdfPath: 'GST Acts/finance_act_of_2022.pdf', outputPath: 'GST Acts/fa_2022_raw.txt', label: 'Finance Act 2022' },
  { id: 'fa-2023', pdfPath: 'GST Acts/finance_act_of_2023.pdf', outputPath: 'GST Acts/fa_2023_raw.txt', label: 'Finance Act 2023' },
];

// Devanagari / Hindi gazette noise patterns to strip
const HINDI_NOISE = /[\u0900-\u097F\u0980-\u09FF]+/g;
const GAZETTE_NOISE = /jftLVªh[^\n]*|vlk\/kkj\.k[^\n]*|izkf\/kdkj[^\n]*|EXTRAORDINARY[^\n]*|PART\s+II\s*—\s*Section\s*1[^\n]*/gi;

function cleanText(text: string): string {
  return text
    .replace(HINDI_NOISE, '')
    .replace(GAZETTE_NOISE, '')
    .replace(/\n{3,}/g, '\n\n')  // collapse excessive blank lines
    .trim();
}

async function extractText(pdfPath: string): Promise<string> {
  const fullPath = join(DATA_DIR, pdfPath);
  const data = new Uint8Array(readFileSync(fullPath));

  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const totalPages = doc.numPages;
  const pageTexts: string[] = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    // Sort items by position (top to bottom, left to right)
    const items = content.items
      .filter((item: any) => item.str !== undefined)
      .sort((a: any, b: any) => {
        const yDiff = b.transform[5] - a.transform[5]; // y is inverted in PDF
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.transform[4] - b.transform[4]; // then left to right
      });

    let pageText = '';
    let lastY = -1;

    for (const item of items as any[]) {
      const y = Math.round(item.transform[5]);
      const text = item.str;

      if (!text.trim()) continue;

      // New line if Y position changed significantly
      if (lastY !== -1 && Math.abs(y - lastY) > 5) {
        pageText += '\n';
      } else if (lastY !== -1) {
        pageText += ' ';
      }

      pageText += text;
      lastY = y;
    }

    if (pageText.trim()) {
      pageTexts.push(pageText.trim());
    }
  }

  await doc.destroy();
  return cleanText(pageTexts.join('\n\n'));
}

async function main() {
  console.log('=== PDF Text Extraction (pdfjs-dist, local) ===\n');

  const filterIds = process.argv.slice(2);
  const toProcess = filterIds.length > 0
    ? MAPPINGS.filter(m => filterIds.includes(m.id))
    : MAPPINGS;

  console.log(`Processing ${toProcess.length} PDFs\n`);

  const results: { id: string; status: string; chars?: number; pages?: number }[] = [];

  for (const mapping of toProcess) {
    const pdfFullPath = join(DATA_DIR, mapping.pdfPath);
    const outFullPath = join(DATA_DIR, mapping.outputPath);

    process.stdout.write(`[${mapping.id}] ${mapping.label}... `);

    if (!existsSync(pdfFullPath)) {
      console.log('SKIP (PDF missing)');
      results.push({ id: mapping.id, status: 'skipped' });
      continue;
    }

    // Backup existing output
    if (existsSync(outFullPath)) {
      copyFileSync(outFullPath, outFullPath.replace('.txt', '.txt.bak'));
    }

    try {
      const text = await extractText(mapping.pdfPath);
      writeFileSync(outFullPath, text, 'utf-8');
      console.log(`${text.length} chars`);
      results.push({ id: mapping.id, status: 'success', chars: text.length });
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      results.push({ id: mapping.id, status: `error: ${err.message}` });
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const success = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status.startsWith('error'));
  console.log(`Success: ${success.length} | Failed: ${failed.length} | Skipped: ${results.length - success.length - failed.length}`);
  if (success.length > 0) {
    const totalKB = success.reduce((sum, r) => sum + (r.chars ?? 0), 0) / 1024;
    console.log(`Total text: ${totalKB.toFixed(0)} KB`);
  }
  if (failed.length > 0) {
    console.log('\nFailed:');
    failed.forEach(r => console.log(`  ${r.id}: ${r.status}`));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
