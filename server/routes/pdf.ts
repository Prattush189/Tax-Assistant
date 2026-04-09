import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, createReadStream, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const DATA_DIR = path.join(__dirname, '..', 'data');

// Whitelist of known PDF files (relative to DATA_DIR)
const ALLOWED_PDFS = new Set([
  // Income Tax Acts
  'Income Tax Acts/Income_Tax_Act_2025_as_amended_by_FA_Act_2026.pdf',
  'Income Tax Acts/Income_Tax_Act_1961_as_amended_by_FA_Act_2026.pdf',
  // GST Acts
  'GST Acts/annexure-3_cgst-act_2017.pdf',
  'GST Acts/annexure-3_cgst-amendment-act_2018.pdf',
  'GST Acts/cgst_ammendment_act_2023.pdf',
  'GST Acts/annexure-5-igst-act_2017.pdf',
  'GST Acts/annexure-5-igst-amendment-act_2018_1.pdf',
  'GST Acts/anneure_6_utgst-act_2017.pdf',
  'GST Acts/annexure-6-utgst-amendment-act_2018.pdf',
  'GST Acts/annexure-3_cgst-extension-to-jammu-and-kashmir-act_2017.pdf',
  'GST Acts/delhi-sgst.pdf',
  'GST Acts/haryana-sgst.pdf',
  'GST Acts/himachal-pradesh-sgst.pdf',
  'GST Acts/madhya-pradesh-sgst.pdf',
  'GST Acts/punjab-sgst.pdf',
  'GST Acts/jammu-and-kashmir-sgst.pdf',
  // Finance Acts
  'GST Acts/finance_act_2019.pdf',
  'GST Acts/finance_act_2020.pdf',
  'GST Acts/finance_act_2021.pdf',
  'GST Acts/finance_act_of_2022.pdf',
  'GST Acts/finance_act_of_2023.pdf',
]);

// GET /api/pdfs/:path(*) — serve a whitelisted PDF
router.get('/*', (req, res) => {
  // Express wildcard: everything after /api/pdfs/
  const requestedPath = req.params[0] || req.path.slice(1);

  if (!ALLOWED_PDFS.has(requestedPath)) {
    return res.status(404).json({ error: 'PDF not found' });
  }

  const filePath = path.join(DATA_DIR, requestedPath);

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF file missing from disk' });
  }

  const stat = statSync(filePath);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=86400');

  createReadStream(filePath).pipe(res);
});

export default router;
