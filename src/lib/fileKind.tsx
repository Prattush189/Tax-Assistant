import { FileText, FileType2, Image as ImageIcon } from 'lucide-react';

/** What the chat composer accepts. Word is .docx only — legacy .doc is a
 *  binary format the server can't read. */
export const CHAT_ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,.webp';
export const CHAT_ACCEPT_LABEL = 'PDF, Word (.docx), JPEG, PNG or WebP';

export type FileKind = 'pdf' | 'word' | 'image' | 'other';

export function fileKind(filename: string, mimeType?: string): FileKind {
  const mt = mimeType ?? '';
  if (mt === 'application/pdf' || /\.pdf$/i.test(filename)) return 'pdf';
  if (mt.includes('wordprocessingml') || /\.docx?$/i.test(filename)) return 'word';
  if (mt.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(filename)) return 'image';
  return 'other';
}

/** Rejects files the composer can't send, with a reason for the toast. */
export function unsupportedReason(file: File): string | null {
  if (/\.doc$/i.test(file.name)) return `"${file.name}" is an old .doc file — open it in Word and save as .docx.`;
  if (fileKind(file.name, file.type) === 'other') return `"${file.name}" isn't supported. Attach a ${CHAT_ACCEPT_LABEL}.`;
  if (file.size > 10 * 1024 * 1024) return `"${file.name}" is over the 10 MB limit.`;
  return null;
}

const KIND_STYLE: Record<FileKind, { label: string; tile: string }> = {
  pdf: { label: 'PDF', tile: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  word: { label: 'Word', tile: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  image: { label: 'Image', tile: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  other: { label: 'File', tile: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
};

export function fileKindLabel(kind: FileKind): string {
  return KIND_STYLE[kind].label;
}

/** Small coloured tile with a type icon — PDF red, Word blue, image violet. */
export function FileKindIcon({ kind, className = 'w-7 h-7' }: { kind: FileKind; className?: string }) {
  const Icon = kind === 'image' ? ImageIcon : kind === 'word' ? FileType2 : FileText;
  return (
    <span className={`${className} rounded-md flex items-center justify-center shrink-0 ${KIND_STYLE[kind].tile}`}>
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}
