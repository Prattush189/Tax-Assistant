import { useState } from 'react';
import { Upload, FileText, Loader2, Send } from 'lucide-react';
import { useFileUpload } from '../../hooks/useFileUpload';
import { NoticeGenerateInput } from '../../services/api';

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
  onGenerate: (input: NoticeGenerateInput) => void;
  isGenerating: boolean;
  usage: { used: number; limit: number };
}

export function NoticeForm({ onGenerate, isGenerating, usage }: NoticeFormProps) {
  const [noticeType, setNoticeType] = useState('income-tax');
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
  const [extractedText, setExtractedText] = useState('');

  const fileUpload = useFileUpload();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const doc = await fileUpload.handleFile(file);
    if (doc?.extractedData?.summary) {
      setExtractedText(doc.extractedData.summary);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyPoints.trim() && !extractedText.trim()) return;

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
      extractedText: extractedText || undefined,
    });
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-[#059669]/50 focus:border-[#059669] outline-none transition-all text-gray-800 dark:text-gray-200";
  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
      {/* Usage counter */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-400">{usage.used}/{usage.limit} drafts this month</span>
        {usage.used >= usage.limit && (
          <span className="text-xs text-red-500 font-medium">Limit reached</span>
        )}
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

      {/* Upload notice document */}
      <div>
        <label className={labelClass}>Upload Notice (optional)</label>
        <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:border-[#059669] transition-colors">
          {fileUpload.uploadPhase === 'uploading' || fileUpload.uploadPhase === 'analyzing' ? (
            <Loader2 className="w-4 h-4 text-[#059669] animate-spin" />
          ) : extractedText ? (
            <FileText className="w-4 h-4 text-green-500" />
          ) : (
            <Upload className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {extractedText ? 'Document uploaded' : 'PDF, JPEG, PNG'}
          </span>
          <input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      {/* Sender details */}
      <details className="group" open>
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
      <details className="group" open>
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

      {/* Key points */}
      <div>
        <label className={labelClass}>Key Points to Address *</label>
        <textarea
          value={keyPoints}
          onChange={e => setKeyPoints(e.target.value)}
          placeholder="Describe the issues raised in the notice and any clarifications or defenses you want to include..."
          rows={4}
          className={`${inputClass} resize-none`}
          required={!extractedText}
        />
      </div>

      {/* Generate button */}
      <button
        type="submit"
        disabled={isGenerating || usage.used >= usage.limit || (!keyPoints.trim() && !extractedText)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#059669] to-[#047857] hover:from-[#047857] hover:to-[#065F46] text-white font-medium rounded-xl shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
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
