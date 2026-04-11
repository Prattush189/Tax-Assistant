import { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { SectionReference } from '../../types';
import { LoadingAnimation } from '../ui/LoadingAnimation';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PdfReferenceModalProps {
  reference: SectionReference;
  onClose: () => void;
}

// Get auth headers for PDF fetch
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('tax_access_token');
  if (token) return { Authorization: `Bearer ${token}` };
  const pluginKey = new URLSearchParams(window.location.search).get('key');
  if (pluginKey) return { 'X-Plugin-Key': pluginKey };
  return {};
}

async function fetchPdfBlob(pdfPath: string): Promise<string> {
  const res = await fetch(`/api/pdfs/${pdfPath}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`Failed to load PDF: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Normalize text for matching: collapse whitespace, lowercase
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Extract section-like identifiers from arbitrary reference text.
 * Matches:
 *   • 80C, 80CCD, 80CCD(1B), 115BAC, 194A, 194J(a), 143(1), 393(1)
 *   • Plain 100-499 three-digit numbers (Act section range)
 * Rejects:
 *   • Years (2020-2030)
 *   • Standalone 2-digit numbers (too noisy)
 *   • Large figures (500+) which are usually amounts, not sections
 */
function extractSectionNumbers(text: string): string[] {
  const found = new Set<string>();
  const regex = /\b(\d{1,3}[A-Z]{0,3}(?:\(\d+[A-Za-z]?\))?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const token = m[1].toUpperCase();
    // Skip years
    if (/^20[0-9]\d$/.test(token)) continue;
    if (/^19[6-9]\d$/.test(token)) continue;
    const hasLetter = /[A-Z]/.test(token);
    const hasBracket = /\(/.test(token);
    // Pure-number tokens must be 100-499 (typical Act section range)
    if (!hasLetter && !hasBracket) {
      const n = parseInt(token, 10);
      if (!Number.isFinite(n) || n < 100 || n > 499) continue;
    }
    found.add(token);
  }
  return Array.from(found);
}

export interface PageSearchResult {
  page: number;
  score: number;
  hadStrongMatch: boolean;
}

/**
 * Find the best PDF page for a reference.
 *
 * Strategy (in order of priority):
 *   1. If the reference text contains explicit section numbers (80C, 194J,
 *      393, etc.), score each page by how many of those appear — with a
 *      strong bonus for "section-header" style matches ("80C." or
 *      "80C " at a word boundary). This nails Act PDFs which are organized
 *      by section.
 *   2. Fall back to literal substring match of the first 150 chars.
 *   3. Last resort: word-overlap scoring (original behaviour).
 *
 * Returns the best page, its score, and whether the match was "strong"
 * (either an exact substring hit or a section-header token match). When
 * `hadStrongMatch` is false, the caller should show a warning that the
 * page may not correspond exactly to the reference text.
 */
async function findPageForText(
  pdfDoc: pdfjs.PDFDocumentProxy,
  searchText: string,
): Promise<PageSearchResult> {
  const sectionTokens = extractSectionNumbers(searchText);
  const needle = normalize(searchText).slice(0, 150);
  const needleWords = needle.split(' ').filter(w => w.length > 3);

  if (sectionTokens.length === 0 && !needle) {
    return { page: 1, score: 0, hadStrongMatch: false };
  }

  let bestPage = 1;
  let bestScore = 0;
  let bestStrong = false;

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPageText = content.items.map((item: any) => item.str ?? '').join(' ');
    const pageText = normalize(rawPageText);
    // De-spaced version so "80 C" and "143 ( 1 )" fragments match "80C" / "143(1)"
    const despaced = rawPageText.replace(/\s+/g, '').toUpperCase();

    let score = 0;
    let strong = false;

    // ── Section-number match ── strongest signal
    for (const tok of sectionTokens) {
      if (despaced.includes(tok)) score += 2;
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const headerRegex = new RegExp(`\\b${escaped}\\.?\\s`, 'i');
      if (headerRegex.test(rawPageText)) {
        score += 10;
        strong = true;
      }
    }

    // ── Literal substring match — strongest fallback ──
    if (needle && pageText.includes(needle)) {
      return { page: i, score: 100, hadStrongMatch: true };
    }

    // ── Word-overlap fallback (weighted lower than section matches) ──
    if (needleWords.length > 0) {
      const hits = needleWords.filter(w => pageText.includes(w)).length;
      score += hits;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPage = i;
      bestStrong = strong;
    }
  }

  // Threshold: a best score below 3 and no strong match means nothing
  // meaningful was found — caller should warn.
  const hadStrongMatch = bestStrong || bestScore >= 3;
  return { page: bestPage, score: bestScore, hadStrongMatch };
}

// Highlight matching text spans on the rendered text layer
function highlightTextLayer(container: HTMLElement, searchText: string) {
  const sectionTokens = extractSectionNumbers(searchText);
  const needle = normalize(searchText).slice(0, 150);
  const needleWords = needle.split(' ').filter(w => w.length > 3);

  if (sectionTokens.length === 0 && needleWords.length === 0) return;

  const spans = container.querySelectorAll<HTMLSpanElement>(
    '.react-pdf__Page__textContent span',
  );

  // Precompute uppercase de-spaced text for section match
  const spanRaw = Array.from(spans).map(s => s.textContent || '');
  const spanNormalized = spanRaw.map(t => normalize(t));
  const spanDespaced = spanRaw.map(t => t.replace(/\s+/g, '').toUpperCase());

  let firstSectionHit: HTMLSpanElement | null = null;

  spans.forEach((span, idx) => {
    const norm = spanNormalized[idx];
    const des = spanDespaced[idx];
    if (!norm) return;

    // Section-number hit → highlight + record for scroll
    const sectionMatched = sectionTokens.some(tok => des.includes(tok));
    if (sectionMatched) {
      span.style.backgroundColor = 'rgba(16, 185, 129, 0.45)';
      span.style.borderBottom = '2px solid rgba(5, 150, 105, 0.85)';
      span.style.borderRadius = '1px';
      span.style.transition = 'background-color 0.3s';
      if (!firstSectionHit) firstSectionHit = span;
      return;
    }

    // Word-overlap fallback highlight (lighter amber)
    if (needleWords.length > 0) {
      const matchCount = needleWords.filter(w => norm.includes(w)).length;
      const threshold = needleWords.length <= 3 ? 1 : 2;
      if (matchCount >= threshold) {
        span.style.backgroundColor = 'rgba(251, 191, 36, 0.35)';
        span.style.borderBottom = '2px solid rgba(245, 158, 11, 0.7)';
        span.style.borderRadius = '1px';
        span.style.transition = 'background-color 0.3s';
      }
    }
  });

  // Prefer scrolling to the first section-number hit, otherwise to the first
  // amber highlight
  const target = firstSectionHit ?? container.querySelector<HTMLSpanElement>(
    '.react-pdf__Page__textContent span[style*="background-color"]',
  );
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ── Single PDF Viewer ──

function SinglePdfViewer({
  pdfPath,
  searchText,
  label,
}: {
  pdfPath: string;
  searchText: string;
  label?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [noExactMatch, setNoExactMatch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [zoom, setZoom] = useState(0.75); // default 75% of container width
  const containerRef = useRef<HTMLDivElement>(null);

  const pageWidth = Math.round(containerWidth * zoom);

  const zoomIn = () => setZoom(z => Math.min(z + 0.15, 2.0));
  const zoomOut = () => setZoom(z => Math.max(z - 0.15, 0.3));
  const zoomReset = () => setZoom(0.75);

  // Responsive container width
  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth - 16);
      }
    }
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Load PDF blob
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPdfBlob(pdfPath)
      .then(url => {
        if (!cancelled) setBlobUrl(url);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  // Clean up blob URL
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const onDocumentLoadSuccess = useCallback(
    async (pdf: pdfjs.PDFDocumentProxy) => {
      setNumPages(pdf.numPages);
      setSearching(true);
      const result = await findPageForText(pdf, searchText);
      setCurrentPage(result.page);
      setNoExactMatch(!result.hadStrongMatch);
      setSearching(false);
    },
    [searchText],
  );

  const onPageRenderSuccess = useCallback(() => {
    if (!containerRef.current) return;
    const textLayer = containerRef.current.querySelector('.react-pdf__Page__textContent');
    if (textLayer) {
      highlightTextLayer(textLayer as HTMLElement, searchText);
    }
  }, [searchText]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500 text-sm">
        {error}
      </div>
    );
  }

  // Show loading state until page is found
  const isReady = !loading && blobUrl && currentPage !== null && !searching;

  return (
    <div ref={containerRef} className="flex flex-col h-full min-w-0">
      {label && (
        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0 text-center">
          {label}
        </div>
      )}

      {/* Toolbar — page nav + zoom controls */}
      {isReady && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 shrink-0">
          {/* Page nav */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, (p ?? 1) - 1))}
              disabled={(currentPage ?? 1) <= 1}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[70px] text-center">
              {currentPage} / {numPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages, (p ?? 1) + 1))}
              disabled={(currentPage ?? 1) >= numPages}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              disabled={zoom <= 0.3}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={zoomReset}
              className="px-1.5 py-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-xs text-gray-600 dark:text-gray-400 min-w-[40px] text-center"
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={zoom >= 2.0}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Weak-match warning */}
      {isReady && noExactMatch && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 shrink-0">
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            The referenced text is editorial / commentary — no exact section match was found in this PDF. Showing the first page.
          </p>
        </div>
      )}

      {/* PDF content */}
      <div className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 flex justify-center">
        {/* Loading overlay — shown until page is found */}
        {!isReady && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <LoadingAnimation size="md" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {loading ? 'Loading PDF...' : 'Finding referenced section...'}
            </span>
          </div>
        )}

        {/* Document always rendered (hidden until ready) so onLoadSuccess fires */}
        {blobUrl && (
          <div className={isReady ? '' : 'hidden'}>
            <Document
              file={blobUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              loading={null}
            >
              {currentPage !== null && (
                <Page
                  pageNumber={currentPage}
                  width={pageWidth}
                  onRenderSuccess={onPageRenderSuccess}
                  loading={
                    <div className="flex items-center justify-center h-64">
                      <LoadingAnimation size="sm" />
                    </div>
                  }
                />
              )}
            </Document>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Modal ──

export function PdfReferenceModal({ reference, onClose }: PdfReferenceModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isSideBySide = !!reference.pdfFiles && reference.pdfFiles.length > 1;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {reference.label}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              Section {reference.section}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        {isSideBySide ? (
          <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
            {reference.pdfFiles!.map((pf, i) => (
              <div
                key={pf.file}
                className={`flex-1 min-w-0 min-h-0 flex flex-col ${
                  i < reference.pdfFiles!.length - 1
                    ? 'border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-700'
                    : ''
                }`}
              >
                <SinglePdfViewer
                  pdfPath={pf.file}
                  searchText={reference.text}
                  label={pf.label}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <SinglePdfViewer
              pdfPath={reference.pdfFile!}
              searchText={reference.text}
            />
          </div>
        )}
      </div>
    </div>
  );
}
