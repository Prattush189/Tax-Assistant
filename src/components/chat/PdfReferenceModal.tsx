import { useState, useEffect, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { X, ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { SectionReference } from '../../types';

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

// Search for chunk text in a PDF document, return best matching page number (1-based)
async function findPageForText(
  pdfDoc: pdfjs.PDFDocumentProxy,
  searchText: string,
): Promise<number> {
  // Use first ~120 chars as search needle
  const needle = normalize(searchText).slice(0, 120);
  if (!needle) return 1;

  let bestPage = 1;
  let bestScore = 0;

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = normalize(
      content.items.map((item: any) => item.str).join(' '),
    );

    // Try substring match
    if (pageText.includes(needle)) return i;

    // Fallback: count overlapping words
    const needleWords = needle.split(' ').filter(w => w.length > 3);
    const hits = needleWords.filter(w => pageText.includes(w)).length;
    const score = hits / Math.max(needleWords.length, 1);
    if (score > bestScore) {
      bestScore = score;
      bestPage = i;
    }
  }

  return bestPage;
}

// Highlight matching text spans on the rendered text layer
function highlightTextLayer(container: HTMLElement, searchText: string) {
  const needle = normalize(searchText).slice(0, 120);
  if (!needle) return;

  const needleWords = needle.split(' ').filter(w => w.length > 3);
  const spans = container.querySelectorAll<HTMLSpanElement>('.react-pdf__Page__textContent span');

  spans.forEach(span => {
    const text = normalize(span.textContent || '');
    const matchCount = needleWords.filter(w => text.includes(w)).length;
    if (matchCount >= 2 || (needleWords.length <= 2 && matchCount >= 1)) {
      span.style.backgroundColor = 'rgba(251, 191, 36, 0.4)';
      span.style.borderRadius = '2px';
    }
  });
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
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

  // Responsive width
  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        setPageWidth(containerRef.current.clientWidth - 16);
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
      pdfDocRef.current = pdf;
      setNumPages(pdf.numPages);
      setSearching(true);
      const page = await findPageForText(pdf, searchText);
      setCurrentPage(page);
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

  return (
    <div ref={containerRef} className="flex flex-col h-full min-w-0">
      {label && (
        <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0 text-center">
          {label}
        </div>
      )}

      {/* Page nav */}
      <div className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <button
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
          {searching ? (
            <span className="flex items-center gap-1 justify-center">
              <Search className="w-3 h-3 animate-pulse" /> Finding...
            </span>
          ) : (
            `Page ${currentPage} / ${numPages}`
          )}
        </span>
        <button
          onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
          disabled={currentPage >= numPages}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* PDF */}
      <div className="flex-1 overflow-auto bg-gray-200 dark:bg-gray-900 flex justify-center">
        {(loading || !blobUrl) ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <Document
            file={blobUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            }
          >
            <Page
              pageNumber={currentPage}
              width={pageWidth}
              onRenderSuccess={onPageRenderSuccess}
              loading={
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              }
            />
          </Document>
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
