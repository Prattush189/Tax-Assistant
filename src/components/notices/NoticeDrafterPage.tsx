import { useEffect, useState } from 'react';
import { FileText, History, ChevronLeft, Trash2 } from 'lucide-react';
import { useNoticeDrafter } from '../../hooks/useNoticeDrafter';
import { NoticeForm } from './NoticeForm';
import { NoticePreview } from './NoticePreview';

export function NoticeDrafterPage() {
  const drafter = useNoticeDrafter();
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    drafter.loadNotices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Page Header */}
      <div className="px-4 lg:px-6 py-3 border-b border-gray-200/50 dark:border-gray-800/50 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#059669]/20 to-[#047857]/20 flex items-center justify-center">
          <FileText className="w-4 h-4 text-[#059669]" />
        </div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-800 dark:text-gray-100">Notice Drafter</h1>
          <p className="text-[11px] text-gray-400">AI-powered professional notice reply drafting</p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          History ({drafter.notices.length})
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* History panel (slide-in) */}
        {showHistory && (
          <div className="w-64 border-r border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 flex flex-col shrink-0">
            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Saved Drafts</span>
              <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {drafter.notices.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No drafts yet</p>
              ) : (
                drafter.notices.map(n => (
                  <button
                    key={n.id}
                    onClick={() => { drafter.loadNotice(n.id); setShowHistory(false); }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                  >
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{n.title || 'Untitled'}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] text-gray-400">{n.notice_type.toUpperCase()}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); drafter.removeNotice(n.id); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Left: Form */}
        <div className="w-full lg:w-[400px] xl:w-[440px] border-r border-gray-200 dark:border-gray-800 p-4 flex flex-col shrink-0 bg-white/30 dark:bg-gray-900/30">
          <NoticeForm
            onGenerate={drafter.generate}
            isGenerating={drafter.isGenerating}
            usage={drafter.usage}
          />
        </div>

        {/* Right: Preview */}
        <div className="hidden lg:flex flex-1 flex-col min-w-0">
          {drafter.error && (
            <div className="mx-4 mt-3 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{drafter.error}</p>
            </div>
          )}
          <NoticePreview
            content={drafter.generatedContent}
            onContentChange={drafter.setGeneratedContent}
            isGenerating={drafter.isGenerating}
            onClear={drafter.clearDraft}
          />
        </div>
      </div>

      {/* Mobile: Show preview below form when content exists */}
      <div className="lg:hidden">
        {(drafter.generatedContent || drafter.isGenerating) && (
          <div className="border-t border-gray-200 dark:border-gray-800 h-[50vh] flex flex-col">
            <NoticePreview
              content={drafter.generatedContent}
              onContentChange={drafter.setGeneratedContent}
              isGenerating={drafter.isGenerating}
              onClear={drafter.clearDraft}
            />
          </div>
        )}
      </div>
    </div>
  );
}
