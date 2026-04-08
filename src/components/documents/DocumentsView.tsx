import { useRef, useState } from 'react';
import { Upload, FileText } from 'lucide-react';
import { uploadFile } from '../../services/api';
import { DocumentContext } from '../../types';
import { DocumentCard } from './DocumentCard';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

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
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex-1 overflow-y-auto p-4 lg:p-8 max-w-2xl mx-auto w-full"
    >
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-400 dark:to-amber-400 bg-clip-text text-transparent">Documents</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Upload Form 16, salary slips, or investment proofs for AI analysis. Ask follow-up questions in the Chat tab.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {!activeDocument ? (
            <motion.div
              key="upload-zone"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              whileHover={!isProcessing ? { scale: 1.01 } : {}}
              whileTap={!isProcessing ? { scale: 0.99 } : {}}
            >
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
                  "relative overflow-hidden border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer backdrop-blur-sm",
                  isDraggingOver
                    ? "border-orange-500 bg-orange-50/80 dark:bg-orange-950/40 shadow-lg shadow-orange-500/10"
                    : "border-gray-300 dark:border-gray-700 hover:border-orange-400 hover:bg-gray-50/50 dark:hover:bg-gray-800/30",
                  isProcessing && "cursor-not-allowed border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/20"
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
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4"
                  >
                    <div className="relative w-16 h-16 mx-auto">
                      <div className="absolute inset-0 border-4 border-orange-200 dark:border-orange-900 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-orange-500 rounded-full border-t-transparent animate-spin"></div>
                    </div>
                    <div>
                      <p className="text-base font-semibold text-orange-700 dark:text-orange-300">
                        {uploadPhase === 'uploading' ? 'Uploading document...' : 'Analyzing with AI...'}
                      </p>
                      <p className="text-xs text-orange-500/80 dark:text-orange-400/80 mt-1">This may take a few seconds</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4"
                  >
                    <div className="flex justify-center">
                      <motion.div 
                        animate={isDraggingOver ? { y: -5 } : { y: 0 }}
                        className="w-16 h-16 rounded-full bg-gradient-to-tr from-orange-100 to-amber-100 dark:from-orange-900/40 dark:to-amber-900/40 flex items-center justify-center shadow-inner"
                      >
                        <Upload className={cn("w-8 h-8 transition-colors", isDraggingOver ? "text-orange-600" : "text-orange-500")} />
                      </motion.div>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200 text-lg">
                        {isDraggingOver ? "Drop it here!" : "Click or drag document"}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">We support PDF and image files</p>
                    </div>
                    <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
                      {['PDF', 'JPEG', 'PNG'].map(fmt => (
                        <span key={fmt} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                          <FileText className="w-3.5 h-3.5" />{fmt}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="document-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <DocumentCard document={activeDocument} onDismiss={handleDismiss} />
            </motion.div>
          )}
        </AnimatePresence>

        {uploadPhase === 'error' && errorMessage && (
          <motion.p 
            initial={{ opacity: 0, height: 0 }} 
            animate={{ opacity: 1, height: 'auto' }}
            className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-3 rounded-lg border border-red-200 dark:border-red-900/50"
          >
            {errorMessage}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}
