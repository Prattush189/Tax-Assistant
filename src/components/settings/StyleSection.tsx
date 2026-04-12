import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Upload, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  getStyleProfile,
  extractStyleProfile,
  deleteStyleProfile,
  StyleProfile,
} from '../../services/api';
import toast from 'react-hot-toast';

type Phase = 'loading' | 'empty' | 'active' | 'extracting';

export function StyleSection() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProfile = useCallback(async () => {
    try {
      const { styleProfile } = await getStyleProfile();
      setProfile(styleProfile);
      setPhase(styleProfile ? 'active' : 'empty');
    } catch {
      setPhase('empty');
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhase('extracting');
    try {
      const result = await extractStyleProfile(file);
      setProfile(result.styleProfile);
      setPhase('active');
      toast.success('Writing style extracted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
      setPhase(profile ? 'active' : 'empty');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePasteExtract = async () => {
    if (pasteText.trim().length < 50) {
      toast.error('Please paste at least 50 characters of sample text.');
      return;
    }
    setPhase('extracting');
    try {
      const result = await extractStyleProfile(pasteText.trim());
      setProfile(result.styleProfile);
      setPhase('active');
      setPasteText('');
      toast.success('Writing style extracted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed');
      setPhase(profile ? 'active' : 'empty');
    }
  };

  const handleRemove = async () => {
    try {
      await deleteStyleProfile();
      setProfile(null);
      setPhase('empty');
      toast.success('Writing style removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  };

  if (phase === 'loading') {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading style profile...
      </div>
    );
  }

  if (phase === 'extracting') {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Analyzing your writing style...
        </p>
        <p className="text-[11px] text-gray-500 dark:text-gray-500 max-w-[280px] text-center">
          AI is reading your sample and extracting tone, phrasing patterns, and structure preferences. This may take 10-20 seconds.
        </p>
      </div>
    );
  }

  if (phase === 'active' && profile) {
    const r = profile.rules;
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40">
          <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              Writing style active
            </p>
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
              Source: {profile.sourceFilename ?? 'Unknown'}
            </p>
          </div>
        </div>

        <dl className="text-xs space-y-2 bg-gray-50 dark:bg-gray-900/40 rounded-xl p-4">
          <StyleRow label="Tone" value={r.tone} />
          <StyleRow label="Formality" value={r.formalityLevel ? `${r.formalityLevel}/10` : undefined} />
          <StyleRow label="Paragraph style" value={r.paragraphStyle} />
          <StyleRow label="Opening" value={r.openingStyle} />
          <StyleRow label="Closing" value={r.closingStyle} />
          <StyleRow label="Citations" value={r.citationStyle} />
          {r.typicalPhrases && r.typicalPhrases.length > 0 && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
              <dt className="text-gray-500 dark:text-gray-500 font-semibold mb-1">Key phrases</dt>
              <dd className="text-gray-700 dark:text-gray-300 flex flex-wrap gap-1">
                {r.typicalPhrases.map((p, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[11px] border border-emerald-200 dark:border-emerald-900/40"
                  >
                    {p}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {r.overallDescription && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
              <dt className="text-gray-500 dark:text-gray-500 font-semibold mb-1">Summary</dt>
              <dd className="text-gray-700 dark:text-gray-300 leading-relaxed">
                {r.overallDescription}
              </dd>
            </div>
          )}
        </dl>

        <div className="flex gap-2">
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Replace
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
          <button
            onClick={handleRemove}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/40 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        </div>
      </div>
    );
  }

  // Empty state — upload or paste
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
        Upload a sample notice letter or paste its text so the AI can learn your preferred writing style.
        This style will be applied to all future notice drafts.
      </p>

      {/* File upload */}
      <label
        className={cn(
          'flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors',
          'border-gray-200 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600',
          'bg-gray-50 dark:bg-gray-900/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10',
        )}
      >
        <Upload className="w-6 h-6 text-gray-400 dark:text-gray-500" />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Drop a <span className="font-medium text-gray-700 dark:text-gray-300">PDF</span> or{' '}
          <span className="font-medium text-gray-700 dark:text-gray-300">DOCX</span> here, or click to browse
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>

      {/* Or divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        <span className="text-[11px] text-gray-400 dark:text-gray-600 uppercase font-medium">or paste text</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      </div>

      {/* Paste textarea */}
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder="Paste a sample notice letter here (at least 50 characters)..."
        rows={5}
        className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100 resize-y"
      />
      <button
        onClick={handlePasteExtract}
        disabled={pasteText.trim().length < 50}
        className={cn(
          'flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all',
          pasteText.trim().length >= 50
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed',
        )}
      >
        <FileText className="w-4 h-4" />
        Analyze Style
      </button>
    </div>
  );
}

function StyleRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3">
      <dt className="text-gray-500 dark:text-gray-500 w-24 shrink-0 font-semibold">{label}</dt>
      <dd className="text-gray-700 dark:text-gray-300">{value}</dd>
    </div>
  );
}
