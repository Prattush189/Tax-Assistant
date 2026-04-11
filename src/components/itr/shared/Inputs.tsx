import { ReactNode, useEffect, useState } from 'react';
import { cn } from '../../../lib/utils';

export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label required={required}>{label}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-gray-400 dark:text-gray-500">{hint}</p>}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

const inputClass =
  'w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400';

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  className,
  uppercase,
  disabled,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  uppercase?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      className={cn(inputClass, className)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
  className,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [raw, setRaw] = useState(value === undefined || value === 0 ? '' : String(value));
  // Sync external changes (e.g. draft autofills) back into the input box
  useEffect(() => {
    setRaw(value === undefined || value === 0 ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={raw}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/[^\d-]/g, '');
        setRaw(cleaned);
        const parsed = cleaned === '' || cleaned === '-' ? 0 : Number(cleaned);
        if (!Number.isNaN(parsed)) onChange(parsed);
      }}
      placeholder={placeholder}
      min={min}
      max={max}
      className={cn(inputClass, className)}
    />
  );
}

export function RupeeInput(props: Parameters<typeof NumberInput>[0]) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
      <NumberInput {...props} className={cn('pl-7', props.className)} />
    </div>
  );
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export function PanInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const invalid = Boolean(value && value.length > 0 && !PAN_REGEX.test(value));
  return (
    <div className="space-y-1">
      <TextInput value={value} onChange={onChange} placeholder="ABCDE1234F" maxLength={10} uppercase />
      {invalid && <p className="text-[11px] text-red-500">Invalid PAN format (5 letters + 4 digits + 1 letter).</p>}
    </div>
  );
}

const AADHAAR_REGEX = /^\d{12}$/;
export function AadhaarInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const invalid = Boolean(value && value.length > 0 && !AADHAAR_REGEX.test(value));
  return (
    <div className="space-y-1">
      <TextInput
        value={value}
        onChange={(v) => onChange(v.replace(/\D/g, ''))}
        placeholder="12-digit Aadhaar"
        maxLength={12}
      />
      {invalid && <p className="text-[11px] text-red-500">Aadhaar must be 12 digits.</p>}
    </div>
  );
}

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function IfscInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const invalid = Boolean(value && value.length > 0 && !IFSC_REGEX.test(value));
  return (
    <div className="space-y-1">
      <TextInput value={value} onChange={onChange} placeholder="SBIN0001234" maxLength={11} uppercase />
      {invalid && <p className="text-[11px] text-red-500">IFSC is 4 letters + 0 + 6 alnum.</p>}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ code: T; label: string }>;
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(inputClass, 'appearance-none', className)}
    >
      <option value="">{placeholder ?? 'Select…'}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          'w-9 h-5 rounded-full transition-colors relative shrink-0',
          checked ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#1a1714] border border-gray-200 dark:border-gray-800 rounded-2xl p-5 space-y-4">
      {(title || action) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Accordion({
  title,
  subtitle,
  defaultOpen,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-[#1a1714] hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
          {subtitle && <p className="text-[11px] text-gray-500 dark:text-gray-500">{subtitle}</p>}
        </div>
        <span className="text-gray-400 text-lg leading-none">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="p-4 bg-gray-50/30 dark:bg-gray-900/20 space-y-4">{children}</div>}
    </div>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

export function Grid3({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{children}</div>;
}
