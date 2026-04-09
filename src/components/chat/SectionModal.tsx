import { useEffect, useRef } from 'react';
import { X, BookOpen } from 'lucide-react';
import { SectionReference } from '../../types';

interface SectionModalProps {
  reference: SectionReference;
  onClose: () => void;
}

export function SectionModal({ reference, onClose }: SectionModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
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
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed font-serif">
            {reference.text}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
          <p className="text-[10px] text-gray-400 dark:text-gray-500">
            Source: {reference.label} — extracted from official Act text
          </p>
        </div>
      </div>
    </div>
  );
}
