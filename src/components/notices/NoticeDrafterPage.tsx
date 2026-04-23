import { FileText } from 'lucide-react';
import { NoticeDrafterState } from '../../hooks/useNoticeDrafter';
import { NoticeForm } from './NoticeForm';
import { NoticePreview } from './NoticePreview';

interface NoticeDrafterPageProps {
  drafter: NoticeDrafterState;
}

export function NoticeDrafterPage({ drafter }: NoticeDrafterPageProps) {
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
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Form */}
        <div className="w-full lg:w-[400px] xl:w-[440px] border-r border-gray-200 dark:border-gray-800 p-4 flex flex-col shrink-0 bg-white/30 dark:bg-gray-900/30">
          <NoticeForm
            onGenerate={drafter.generate}
            isGenerating={drafter.isGenerating}
            usage={drafter.usage}
            letterhead={drafter.letterhead}
            onLetterheadChange={drafter.setLetterhead}
            currentNoticeId={drafter.currentNoticeId}
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
            letterhead={drafter.letterhead}
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
              letterhead={drafter.letterhead}
            />
          </div>
        )}
      </div>
    </div>
  );
}
