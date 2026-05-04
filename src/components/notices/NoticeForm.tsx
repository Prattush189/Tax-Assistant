import { useEffect, useRef, useState } from 'react';
import { Upload, FileText, Send, Image as ImageIcon, X } from 'lucide-react';
import { NoticeGenerateInput } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import { LetterheadConfig } from '../../hooks/useNoticeDrafter';
import { LoadFromProfile } from '../profile/shared/LoadFromProfile';
import { profileToNoticeForm } from '../profile/lib/prefillAdapters';
import { cn } from '../../lib/utils';

const NOTICE_TYPES = [
  { value: 'income-tax', label: 'Income Tax' },
  { value: 'gst', label: 'GST' },
  { value: 'tds', label: 'TDS' },
  { value: 'legal', label: 'General Legal' },
];

const SUB_TYPES: Record<string, { value: string; label: string }[]> = {
  'income-tax': [
    { value: '143(1)', label: 'Intimation u/s 143(1)' },
    { value: '142(1)', label: 'Inquiry u/s 142(1)' },
    { value: '148', label: 'Reassessment u/s 148' },
    { value: '156', label: 'Demand Notice u/s 156' },
    { value: '143(2)', label: 'Scrutiny u/s 143(2)' },
    { value: '245', label: 'Set-off Notice u/s 245' },
    { value: 'other', label: 'Other' },
  ],
  'gst': [
    { value: 'DRC-01', label: 'Show Cause Notice (DRC-01)' },
    { value: 'DRC-07', label: 'Demand Order (DRC-07)' },
    { value: 'ASMT-10', label: 'Scrutiny (ASMT-10)' },
    { value: 'REG-17', label: 'Cancellation Notice (REG-17)' },
    { value: 'other', label: 'Other' },
  ],
  'tds': [
    { value: 'short-deduction', label: 'Short Deduction' },
    { value: 'late-filing', label: 'Late Filing' },
    { value: 'default', label: 'Default Notice' },
    { value: 'other', label: 'Other' },
  ],
  'legal': [
    { value: 'compliance', label: 'Compliance Notice' },
    { value: 'penalty', label: 'Penalty Notice' },
    { value: 'other', label: 'Other' },
  ],
};

interface NoticeFormProps {
  onGenerate: (input: NoticeGenerateInput, file?: File) => void;
  isGenerating: boolean;
  usage: { used: number };
  letterhead: LetterheadConfig;
  onLetterheadChange: (config: LetterheadConfig) => void;
  currentNoticeId: string | null;
}

const MAX_IMAGE_SIZE_BYTES = 500 * 1024; // 500KB cap to keep localStorage sane

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function NoticeForm({ onGenerate, isGenerating, usage, letterhead, onLetterheadChange, currentNoticeId }: NoticeFormProps) {
  const [noticeType, setNoticeType] = useState('income-tax');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [subType, setSubType] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderAddress, setSenderAddress] = useState('');
  const [senderPan, setSenderPan] = useState('');
  const [senderGstin, setSenderGstin] = useState('');
  const [recipientOfficer, setRecipientOfficer] = useState('');
  const [recipientOffice, setRecipientOffice] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [noticeNumber, setNoticeNumber] = useState('');
  const [noticeDate, setNoticeDate] = useState('');
  const [section, setSection] = useState('');
  const [assessmentYear, setAssessmentYear] = useState('');
  const [keyPoints, setKeyPoints] = useState('');
  const [noticeFile, setNoticeFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const headerImgRef = useRef<HTMLInputElement>(null);
  const watermarkImgRef = useRef<HTMLInputElement>(null);

  // Clear per-notice fields when a new notice is successfully generated so old
  // data doesn't contaminate the next draft.
  const prevNoticeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentNoticeId && currentNoticeId !== prevNoticeIdRef.current) {
      prevNoticeIdRef.current = currentNoticeId;
      setKeyPoints('');
      setNoticeFile(null);
      setFileError(null);
      setSubType('');
      setNoticeNumber('');
      setNoticeDate('');
      setSection('');
      setAssessmentYear('');
      setRecipientOfficer('');
      setRecipientOffice('');
      setRecipientAddress('');
      if (noticeFileRef.current) noticeFileRef.current.value = '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNoticeId]);

  const updateHeader = (patch: Partial<LetterheadConfig['header']>) => {
    onLetterheadChange({ ...letterhead, header: { ...letterhead.header, ...patch } });
  };
  const updateWatermark = (patch: Partial<LetterheadConfig['watermark']>) => {
    onLetterheadChange({ ...letterhead, watermark: { ...letterhead.watermark, ...patch } });
  };

  const handleHeaderImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      alert('Image too large. Please use an image under 500KB.');
      e.target.value = '';
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    updateHeader({ imageDataUrl: dataUrl });
    e.target.value = '';
  };

  const handleWatermarkImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      alert('Image too large. Please use an image under 500KB.');
      e.target.value = '';
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    updateWatermark({ imageDataUrl: dataUrl });
    e.target.value = '';
  };

  const noticeFileRef = useRef<HTMLInputElement>(null);

  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — match server limit

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Please upload a PDF or image (JPEG, PNG, WebP).');
      setNoticeFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError('File exceeds the 10 MB size limit.');
      setNoticeFile(null);
      return;
    }
    // PDF page count is no longer capped — the 10 MB file-size limit
    // and token budget are the only gates.
    setFileError(null);
    setNoticeFile(file);
  };

  const handleClearUpload = () => {
    setNoticeFile(null);
    setFileError(null);
    if (noticeFileRef.current) noticeFileRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Pre-flight validation. Catches missing required fields BEFORE
    // we burn a Gemini call — the server validates again as a backstop,
    // but a fail there has already cost the user one credit's worth of
    // tokens (and on slow paths, several minutes of wait time). Each
    // check below maps to a specific server-side rejection we've
    // previously surfaced to users.
    if (!subType) {
      setSubmitError('Pick a Sub-type / Section before generating — the AI uses it to choose the right reply template.');
      return;
    }
    if (!keyPoints.trim() && !noticeFile) {
      setSubmitError('Provide either Key Points to address, or upload the notice PDF — the model needs at least one input.');
      return;
    }
    setSubmitError(null);

    onGenerate({
      noticeType,
      subType: subType || undefined,
      senderDetails: {
        name: senderName || undefined,
        address: senderAddress || undefined,
        pan: senderPan || undefined,
        gstin: senderGstin || undefined,
      },
      recipientDetails: {
        officer: recipientOfficer || undefined,
        office: recipientOffice || undefined,
        address: recipientAddress || undefined,
      },
      noticeDetails: {
        noticeNumber: noticeNumber || undefined,
        noticeDate: noticeDate || undefined,
        section: section || subType || undefined,
        assessmentYear: assessmentYear || undefined,
      },
      keyPoints: keyPoints.trim(),
    }, noticeFile ?? undefined);
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-[#059669]/50 focus:border-[#059669] outline-none transition-all text-gray-800 dark:text-gray-200";
  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
      {/* fieldset[disabled] cascades to every input/select/button it
          contains — one-line guarantee that the form can't be edited
          while a generation is in flight. The submit button is OUTSIDE
          this fieldset so it can keep its own disabled logic (which
          also covers the in-flight case). display:contents lets the
          fieldset participate in the form's flexbox flow without its
          default border / padding box. */}
      <fieldset disabled={isGenerating} className="contents">
      {/* Usage counter — analytics display only. The cross-feature
          token budget (shown in Settings) is the hard quota. */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-400">{usage.used} draft{usage.used === 1 ? '' : 's'} this period</span>
      </div>

      {/* Notice Type + Sub-type */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Notice Type</label>
          <select
            value={noticeType}
            onChange={(e) => { setNoticeType(e.target.value); setSubType(''); }}
            className={inputClass}
          >
            {NOTICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Sub-type / Section</label>
          <select value={subType} onChange={(e) => setSubType(e.target.value)} className={inputClass}>
            <option value="">Select...</option>
            {(SUB_TYPES[noticeType] || []).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Upload notice document — file is sent on submit; the server extracts it */}
      <div>
        <label className={labelClass}>Upload Notice (optional)</label>
        {noticeFile ? (
          <div className="flex items-center gap-2 px-3 py-2.5 border-2 border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <FileText className="w-4 h-4 text-green-500 shrink-0" />
            <span className="text-sm text-green-700 dark:text-green-400 flex-1 truncate">{noticeFile.name}</span>
            <button type="button" onClick={handleClearUpload} className="text-green-400 hover:text-green-600 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className={cn(
            "flex items-center gap-2 px-3 py-2.5 border-2 border-dashed rounded-lg transition-colors",
            isGenerating
              ? "border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed opacity-60"
              : "border-gray-200 dark:border-gray-700 cursor-pointer hover:border-[#059669]"
          )}>
            <Upload className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {isGenerating ? 'Generation in progress…' : 'PDF, JPEG, PNG (max 10 MB)'}
            </span>
            <input
              ref={noticeFileRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={handleFileUpload}
              disabled={isGenerating}
              className="hidden"
            />
          </label>
        )}
        {fileError && (
          <p className="mt-1 text-xs text-red-500">{fileError}</p>
        )}
      </div>

      {/* Profile prefill */}
      <div className="flex justify-end">
        <LoadFromProfile
          onPick={(profile) => {
            const prefill = profileToNoticeForm(profile);
            if (prefill.senderName !== undefined) setSenderName(prefill.senderName ?? '');
            if (prefill.senderAddress !== undefined) setSenderAddress(prefill.senderAddress ?? '');
            if (prefill.senderPan !== undefined) setSenderPan(prefill.senderPan ?? '');
            if (prefill.senderGstin !== undefined) setSenderGstin(prefill.senderGstin ?? '');
            if (prefill.recipientOfficer !== undefined) setRecipientOfficer(prefill.recipientOfficer ?? '');
            if (prefill.recipientOffice !== undefined) setRecipientOffice(prefill.recipientOffice ?? '');
            if (prefill.recipientAddress !== undefined) setRecipientAddress(prefill.recipientAddress ?? '');
          }}
          label="Load from profile"
          compact
        />
      </div>

      {/* Sender details */}
      <details className="group">
        <summary className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none">
          Sender Details
        </summary>
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Name</label>
              <input value={senderName} onChange={e => setSenderName(e.target.value)} placeholder="Your name" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{noticeType === 'gst' ? 'GSTIN' : 'PAN'}</label>
              {noticeType === 'gst' ? (
                <input value={senderGstin} onChange={e => setSenderGstin(e.target.value)} placeholder="22AAAAA0000A1Z5" className={inputClass} />
              ) : (
                <input value={senderPan} onChange={e => setSenderPan(e.target.value)} placeholder="ABCDE1234F" className={inputClass} />
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Address</label>
            <input value={senderAddress} onChange={e => setSenderAddress(e.target.value)} placeholder="Full address" className={inputClass} />
          </div>
        </div>
      </details>

      {/* Recipient details */}
      <details className="group">
        <summary className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none">
          Recipient (Officer) Details
        </summary>
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Officer / Designation</label>
              <input value={recipientOfficer} onChange={e => setRecipientOfficer(e.target.value)} placeholder="ITO / ACIT / Proper Officer" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Office / Ward</label>
              <input value={recipientOffice} onChange={e => setRecipientOffice(e.target.value)} placeholder="Ward 5(1), Circle 3" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Office Address</label>
            <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} placeholder="Office address" className={inputClass} />
          </div>
        </div>
      </details>

      {/* Notice reference */}
      <details className="group">
        <summary className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none">
          Notice Reference
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Notice No.</label>
            <input value={noticeNumber} onChange={e => setNoticeNumber(e.target.value)} placeholder="ITBA/..." className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Notice Date</label>
            <input type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Section</label>
            <input value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. 143(1)" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>AY / Period</label>
            <input value={assessmentYear} onChange={e => setAssessmentYear(e.target.value)} placeholder="2024-25" className={inputClass} />
          </div>
        </div>
      </details>

      {/* Letterhead & Watermark */}
      <details className="group">
        <summary className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none">
          Letterhead &amp; Watermark
        </summary>
        <div className="mt-3 space-y-4">
          {/* Header */}
          <div className="p-3 bg-white/60 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Header / Letterhead</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={letterhead.header.enabled}
                  onChange={e => updateHeader({ enabled: e.target.checked })}
                  className="w-3.5 h-3.5 accent-[#059669]"
                />
                <span className="text-[11px] text-gray-500">Enabled</span>
              </label>
            </div>
            {letterhead.header.enabled && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={letterhead.header.type}
                    onChange={e => updateHeader({ type: e.target.value as 'text' | 'image' })}
                    className={inputClass}
                  >
                    <option value="text">Plain Text</option>
                    <option value="image">Logo / Image</option>
                  </select>
                  <select
                    value={letterhead.header.align}
                    onChange={e => updateHeader({ align: e.target.value as 'left' | 'center' | 'right' })}
                    className={inputClass}
                  >
                    <option value="left">Align Left</option>
                    <option value="center">Align Center</option>
                    <option value="right">Align Right</option>
                  </select>
                </div>
                {letterhead.header.type === 'text' ? (
                  <textarea
                    value={letterhead.header.text}
                    onChange={e => updateHeader({ text: e.target.value })}
                    placeholder="Your firm name&#10;Address, phone, email"
                    rows={2}
                    className={`${inputClass} resize-none`}
                  />
                ) : (
                  <div className="space-y-2">
                    {letterhead.header.imageDataUrl ? (
                      <div className="relative inline-block">
                        <img
                          src={letterhead.header.imageDataUrl}
                          alt="Header logo"
                          className="max-h-16 max-w-full object-contain rounded border border-gray-200 dark:border-gray-700"
                        />
                        <button
                          type="button"
                          onClick={() => updateHeader({ imageDataUrl: '' })}
                          className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 text-white rounded-full hover:bg-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => headerImgRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg hover:border-[#059669] transition-colors"
                      >
                        <ImageIcon className="w-4 h-4 text-gray-400" />
                        <span className="text-xs text-gray-500">Upload logo (max 500KB)</span>
                      </button>
                    )}
                    <input
                      ref={headerImgRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleHeaderImage}
                      className="hidden"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Watermark */}
          <div className="p-3 bg-white/60 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Watermark</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={letterhead.watermark.enabled}
                  onChange={e => updateWatermark({ enabled: e.target.checked })}
                  className="w-3.5 h-3.5 accent-[#059669]"
                />
                <span className="text-[11px] text-gray-500">Enabled</span>
              </label>
            </div>
            {letterhead.watermark.enabled && (
              <>
                <select
                  value={letterhead.watermark.type}
                  onChange={e => updateWatermark({ type: e.target.value as 'text' | 'image' })}
                  className={inputClass}
                >
                  <option value="text">Plain Text</option>
                  <option value="image">Logo / Image</option>
                </select>
                {letterhead.watermark.type === 'text' ? (
                  <input
                    value={letterhead.watermark.text}
                    onChange={e => updateWatermark({ text: e.target.value })}
                    placeholder="DRAFT / CONFIDENTIAL"
                    className={inputClass}
                  />
                ) : (
                  <div className="space-y-2">
                    {letterhead.watermark.imageDataUrl ? (
                      <div className="relative inline-block">
                        <img
                          src={letterhead.watermark.imageDataUrl}
                          alt="Watermark"
                          className="max-h-16 max-w-full object-contain rounded border border-gray-200 dark:border-gray-700 opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => updateWatermark({ imageDataUrl: '' })}
                          className="absolute -top-1.5 -right-1.5 p-0.5 bg-red-500 text-white rounded-full hover:bg-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => watermarkImgRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg hover:border-[#059669] transition-colors"
                      >
                        <ImageIcon className="w-4 h-4 text-gray-400" />
                        <span className="text-xs text-gray-500">Upload watermark (max 500KB)</span>
                      </button>
                    )}
                    <input
                      ref={watermarkImgRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleWatermarkImage}
                      className="hidden"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Opacity: {letterhead.watermark.opacity}%</label>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={letterhead.watermark.opacity}
                    onChange={e => updateWatermark({ opacity: Number(e.target.value) })}
                    className="w-full accent-[#059669]"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </details>

      {/* Key points */}
      <div>
        <label className={labelClass}>Key Points to Address *</label>
        <textarea
          value={keyPoints}
          onChange={e => setKeyPoints(e.target.value)}
          placeholder="Describe the issues raised in the notice and any clarifications or defenses you want to include..."
          rows={4}
          className={`${inputClass} resize-none`}
          required={!noticeFile}
        />
      </div>

      </fieldset>

      {/* Pre-flight validation error — shown above the submit button
          so the user sees it without scrolling. */}
      {submitError && (
        <p className="text-xs text-red-500 px-1">{submitError}</p>
      )}

      {/* Generate button */}
      <button
        type="submit"
        disabled={isGenerating || (!keyPoints.trim() && !noticeFile)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#059669] to-[#047857] hover:from-[#047857] hover:to-[#065F46] text-white font-medium rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <LoadingAnimation size="xs" />
            Generating...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Generate Draft
          </>
        )}
      </button>
    </form>
  );
}
