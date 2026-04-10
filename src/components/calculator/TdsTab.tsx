import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { cn, formatINR } from '../../lib/utils';
import {
  calculateTDS,
  TDS_SECTIONS,
  TDS_FY_OPTIONS,
  TDS_CATEGORY_OPTIONS,
  DEDUCTION_TYPE_LABELS,
  resolveTdsRates,
  getTdsSectionsForCategory,
  getAllowedDeductionTypes,
  type TdsFY,
  type TdsCategory,
  type TdsSection,
  type DeductionType,
  type PayeeStatus,
} from '../../lib/tdsEngine';

/**
 * Given an FY, should we show the IT Act 2025 (new) section as primary?
 * The new Act comes into force from FY 2026-27 onwards.
 */
function isNewActActive(fy: TdsFY): boolean {
  return fy === '2026-27';
}

function sectionLabel(section: TdsSection, fy: TdsFY): string {
  const showNewFirst = isNewActActive(fy);
  if (showNewFirst && section.newSection) {
    return `${section.newSection} (${section.oldSection})`;
  }
  if (!showNewFirst && section.newSection) {
    return `${section.oldSection} (new: ${section.newSection})`;
  }
  return section.oldSection;
}

export function TdsTab() {
  const [fy, setFy] = useState<TdsFY>('2025-26');
  const [category, setCategory] = useState<TdsCategory>('resident');
  const [sectionId, setSectionId] = useState<string>(
    getTdsSectionsForCategory('resident')[0].id,
  );
  const [amount, setAmount] = useState('');
  const [hasPAN, setHasPAN] = useState(true);
  const [deductionType, setDeductionType] = useState<DeductionType>('prescribed');
  const [aggregatePaid, setAggregatePaid] = useState('');
  const [lowerRatePct, setLowerRatePct] = useState('');
  const [payeeStatus, setPayeeStatus] = useState<PayeeStatus>('individual');

  // Combobox state
  const [comboOpen, setComboOpen] = useState(false);
  const [comboQuery, setComboQuery] = useState('');
  const comboRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sectionsInCategory = useMemo(
    () => getTdsSectionsForCategory(category),
    [category],
  );

  useEffect(() => {
    if (!sectionsInCategory.some(s => s.id === sectionId)) {
      setSectionId(sectionsInCategory[0].id);
    }
  }, [category, sectionId, sectionsInCategory]);

  // Close combobox on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
      }
    }
    if (comboOpen) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [comboOpen]);

  useEffect(() => {
    if (comboOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
  }, [comboOpen]);

  const filteredSections = useMemo(() => {
    const q = comboQuery.trim().toLowerCase();
    if (!q) return sectionsInCategory;
    return sectionsInCategory.filter(s => {
      const haystack = `${s.oldSection} ${s.newSection ?? ''} ${s.description}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [sectionsInCategory, comboQuery]);

  const selectedSection = sectionsInCategory.find(s => s.id === sectionId) ?? sectionsInCategory[0];
  const showNewFirst = isNewActActive(fy);

  // Allowed deduction types for the current section
  const allowedDeductionTypes = useMemo(
    () => getAllowedDeductionTypes(selectedSection),
    [selectedSection],
  );

  // If current deductionType becomes unavailable after switching sections, reset it
  useEffect(() => {
    if (!allowedDeductionTypes.includes(deductionType)) {
      setDeductionType('prescribed');
    }
  }, [allowedDeductionTypes, deductionType]);

  const resolvedRates = useMemo(
    () => resolveTdsRates(selectedSection, fy),
    [selectedSection, fy],
  );

  const hasPerEntryThreshold = (resolvedRates.perEntryThreshold ?? 0) > 0;

  // Calculation
  const { result, error } = useMemo(() => {
    const num = Number(amount) || 0;
    if (num <= 0) return { result: null, error: null };
    try {
      const res = calculateTDS({
        sectionId: selectedSection.id,
        fy,
        amount: num,
        hasPAN,
        deductionType,
        aggregatePaid: Number(aggregatePaid) || 0,
        lowerRate: deductionType === 'lower' ? (Number(lowerRatePct) || 0) / 100 : undefined,
        payeeStatus,
      });
      return { result: res, error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Calculation error' };
    }
  }, [amount, selectedSection.id, fy, hasPAN, deductionType, aggregatePaid, lowerRatePct, payeeStatus]);

  return (
    <div className="max-w-2xl">
      {/* FY + Type row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Financial Year
          </label>
          <div className="relative">
            <select
              value={fy}
              onChange={e => setFy(e.target.value as TdsFY)}
              className="w-full appearance-none pl-3 pr-9 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {TDS_FY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Type
          </label>
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-0.5 w-full">
            {TDS_CATEGORY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setCategory(opt.value)}
                className={cn(
                  'flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors',
                  category === opt.value
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
                )}
                title={`Form ${opt.form}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Searchable section combobox */}
      <div className="mb-5" ref={comboRef}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Payment Type / Section
        </label>
        <div className="relative">
          <button
            type="button"
            onClick={() => setComboOpen(o => !o)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-left hover:border-emerald-400 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold shrink-0">
                  {showNewFirst && selectedSection.newSection
                    ? selectedSection.newSection
                    : selectedSection.oldSection}
                </span>
                {selectedSection.newSection && (
                  <span className="text-[11px] text-gray-400 truncate">
                    {showNewFirst ? `old: ${selectedSection.oldSection}` : `new: ${selectedSection.newSection}`}
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {selectedSection.description}
              </div>
            </div>
            <ChevronDown className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', comboOpen && 'rotate-180')} />
          </button>

          {comboOpen && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
              <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={comboQuery}
                    onChange={e => setComboQuery(e.target.value)}
                    placeholder="Search by section or description…"
                    className="w-full pl-8 pr-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto py-1">
                {filteredSections.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-gray-400">
                    No sections match "{comboQuery}"
                  </div>
                ) : (
                  filteredSections.map(s => {
                    const isSelected = s.id === sectionId;
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSectionId(s.id);
                          setComboOpen(false);
                          setComboQuery('');
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors',
                          isSelected && 'bg-emerald-50 dark:bg-emerald-900/20',
                        )}
                      >
                        <Check
                          className={cn(
                            'w-4 h-4 mt-0.5 shrink-0',
                            isSelected ? 'text-emerald-600' : 'text-transparent',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                              {showNewFirst && s.newSection ? s.newSection : s.oldSection}
                            </span>
                            {s.newSection && (
                              <span className="text-[10px] text-gray-400">
                                {showNewFirst ? `↔ ${s.oldSection}` : `↔ ${s.newSection}`}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {s.description}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deduction Type selector — only if section has more than one option */}
      {allowedDeductionTypes.length > 1 && (
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Deduction Type
          </label>
          <div className="flex flex-wrap gap-2">
            {allowedDeductionTypes.map(dt => (
              <button
                key={dt}
                onClick={() => setDeductionType(dt)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  deductionType === dt
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-emerald-400',
                )}
              >
                {DEDUCTION_TYPE_LABELS[dt]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lower rate input — only when 'lower' selected */}
      {deductionType === 'lower' && (
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Lower Rate (from 197 certificate)
          </label>
          <div className="relative max-w-[160px]">
            <input
              type="number"
              min="0"
              step="0.01"
              value={lowerRatePct}
              onChange={e => setLowerRatePct(e.target.value)}
              placeholder="0.00"
              className="w-full pr-8 pl-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
          </div>
        </div>
      )}

      {/* Payee status — only for 194 dividend */}
      {selectedSection.payeeStatusAffectsThreshold && (
        <div className="mb-5">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payee Status</p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="payee-status"
                checked={payeeStatus === 'individual'}
                onChange={() => setPayeeStatus('individual')}
                className="accent-emerald-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Individual / HUF</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="payee-status"
                checked={payeeStatus === 'other'}
                onChange={() => setPayeeStatus('other')}
                className="accent-emerald-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Company / Firm / Other</span>
            </label>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            Threshold of {formatINR(resolvedRates.threshold)} only applies to individuals.
          </p>
        </div>
      )}

      {/* Amount inputs */}
      <div className={cn('grid gap-4 mb-5', hasPerEntryThreshold ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {hasPerEntryThreshold ? 'Current payment' : 'Payment amount'}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">₹</span>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {hasPerEntryThreshold && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Aggregate paid in FY <span className="text-gray-400">(excluding this)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">₹</span>
              <input
                type="number"
                min="0"
                value={aggregatePaid}
                onChange={e => setAggregatePaid(e.target.value)}
                placeholder="0"
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* PAN toggle */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">PAN Available</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tds-pan"
              checked={hasPAN}
              onChange={() => setHasPAN(true)}
              className="accent-emerald-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Yes</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tds-pan"
              checked={!hasPAN}
              onChange={() => setHasPAN(false)}
              className="accent-emerald-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">No</span>
          </label>
        </div>
      </div>

      {/* Rate preview */}
      <div className="mb-4 px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Rate (with PAN)</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {(resolvedRates.rate * 100).toFixed(2)}%
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Rate (without PAN)</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {(resolvedRates.rateWithoutPAN * 100).toFixed(2)}%
            </p>
          </div>
          {hasPerEntryThreshold ? (
            <>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Per-entry</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {formatINR(resolvedRates.perEntryThreshold ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Aggregate</p>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {formatINR(resolvedRates.threshold)}
                </p>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <p className="text-gray-500 dark:text-gray-400">Threshold</p>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {resolvedRates.threshold > 0 ? formatINR(resolvedRates.threshold) : 'None'}
              </p>
            </div>
          )}
        </div>
        {selectedSection.thresholdNote && (
          <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500 italic">
            {selectedSection.thresholdNote}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-5 mb-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                {sectionLabel(result.section, result.fy)}
              </span>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{result.section.description}</p>
            </div>
            {result.triggeredBy === 'perEntry' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 whitespace-nowrap">
                Per-entry trigger
              </span>
            )}
            {result.triggeredBy === 'aggregate' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 whitespace-nowrap">
                Aggregate trigger
              </span>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Payment amount</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.amount)}</span>
            </div>
            {(result.aggregateTotal ?? 0) > result.amount && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Aggregate (incl. prior)</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.aggregateTotal!)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">TDS rate ({result.fy})</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{(result.tdsRate * 100).toFixed(2)}%</span>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-1 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">
                  {result.section.category === 'tcs' ? 'TCS amount' : 'TDS amount'}
                </span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.tdsAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 dark:text-gray-100 font-bold">Net payment</span>
                <span className="text-gray-800 dark:text-gray-100 font-bold">{formatINR(result.netPayment)}</span>
              </div>
            </div>
          </div>

          {result.skipReason === 'notDeducted' && (
            <div className="mt-3 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-400">
              Marked as <strong>Not Deducted</strong> — no TDS will be withheld (e.g. Form 15G/15H declaration).
            </div>
          )}
          {result.skipReason === 'transporter' && (
            <div className="mt-3 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-400">
              Marked as <strong>Transporter</strong> — no TDS if the transporter operates ≤ 10 goods carriages and has furnished a valid declaration with PAN.
            </div>
          )}
          {result.skipReason === 'belowThreshold' && (
            <div className="mt-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-xs text-yellow-700 dark:text-yellow-300">
              Below threshold — aggregate ({formatINR(result.aggregateTotal ?? result.amount)}) has not crossed {formatINR(result.effectiveThreshold)}
              {result.effectivePerEntryThreshold ? ` and no single bill reached ${formatINR(result.effectivePerEntryThreshold)}` : ''}.
              No {result.section.category === 'tcs' ? 'TCS' : 'TDS'} applicable.
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Rates are basic TDS/TCS — surcharge and cess (where applicable) are not included. Section 192 (Salary) is slab-based; the rate shown is indicative. Without PAN, TDS is deducted at 20% (5% for 194-O / 194Q). DTAA benefits may reduce rates for non-residents. Lower-rate certificates under section 197 override the prescribed rate.
      </p>
    </div>
  );
}
