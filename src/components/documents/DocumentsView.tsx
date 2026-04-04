import { useRef, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { uploadFile } from '../../services/api';
import { DocumentContext } from '../../types';
import { DocumentCard } from './DocumentCard';
import { cn } from '../../lib/utils';

type UploadPhase = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error';

interface DocumentsViewProps {
  activeDocument: DocumentContext | null;
  onDocumentAttach: (doc: DocumentContext) => void;
  onDocumentDetach: () => void;
}

export function DocumentsView({ activeDocument, onDocumentAttach, onDocumentDetach }: DocumentsViewProps) {
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setErrorMessage('');
    setUploadPhase('uploading');

    try {
      // Phase 1: uploading (multer + Files API transfer)
      // Phase 2: analyzing (generateContent call, typically longer)
      // We transition to 'analyzing' after a short buffer — the server does both steps
      // in one request, so we use a timeout heuristic for the two-phase UX display
      const analyzeTimer = setTimeout(() => {
        setUploadPhase('analyzing');
      }, 1500);

      const result = await uploadFile(file);
      clearTimeout(analyzeTimer);

      const doc: DocumentContext = {
        filename: result.filename,
        mimeType: result.mimeType,
        fileUri: result.fileUri,
        extractedData: result.extractedData,
      };

      onDocumentAttach(doc);
      setUploadPhase('done');
    } catch (err) {
      setUploadPhase('error');
      setErrorMessage(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so same file can be re-selected after dismissal
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleDismiss = () => {
    onDocumentDetach();
    setUploadPhase('idle');
    setErrorMessage('');
  };

  const isProcessing = uploadPhase === 'uploading' || uploadPhase === 'analyzing';

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 max-w-2xl mx-auto w-full">
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Documents</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Upload Form 16, salary slips, or investment proofs for AI analysis. Ask follow-up questions in the Chat tab.
          </p>
        </div>

        {/* Upload zone — hidden when a document is already active */}
        {!activeDocument && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload tax document"
            onClick={() => !isProcessing && inputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && !isProcessing && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
              isDraggingOver
                ? "border-orange-400 bg-orange-50 dark:bg-orange-950/20"
                : "border-slate-300 dark:border-slate-600 hover:border-orange-400 hover:bg-slate-50 dark:hover:bg-slate-800/50",
              isProcessing && "cursor-not-allowed opacity-70"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp,image/heic"
              className="hidden"
              onChange={handleInputChange}
              disabled={isProcessing}
            />

            {isProcessing ? (
              <div className="space-y-2">
                <div className="w-8 h-8 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  {uploadPhase === 'uploading' ? 'Uploading document...' : 'Analyzing with AI...'}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">This may take a few seconds</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-center">
                  <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                    <Upload className="w-6 h-6 text-orange-500" />
                  </div>
                </div>
                <div>
                  <p className="font-medium text-slate-700 dark:text-slate-200">Drop your document here</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">or click to browse</p>
                </div>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {['PDF', 'JPEG', 'PNG', 'WebP', 'HEIC'].map(fmt => (
                    <span key={fmt} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      <FileText className="w-3 h-3" />{fmt}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Maximum 10MB</p>
              </div>
            )}
          </div>
        )}

        {/* Inline error — shown below upload zone, not as a toast */}
        {uploadPhase === 'error' && errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
        )}

        {/* Document summary card */}
        {activeDocument && (
          <DocumentCard document={activeDocument} onDismiss={handleDismiss} />
        )}
      </div>
    </div>
  );
}
