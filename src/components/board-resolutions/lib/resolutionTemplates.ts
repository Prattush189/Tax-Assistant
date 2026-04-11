/**
 * Template definitions for the 4 v1 board resolutions.
 *
 * Each template contributes:
 *   - id / title / subtitle — wizard picker + PDF header
 *   - governingSections — rendered as an "under authority of …" italic line
 *   - body(draft) — returns the RESOLVED THAT paragraphs. Called by both the
 *     Review preview and the PDF renderer so the two stay in sync.
 *
 * Language is adapted from commonly used Indian Companies Act 2013 templates
 * (see plan file for sources). Users must still have the output reviewed by
 * a qualified Company Secretary before filing.
 */
import type { BoardResolutionDraft, TemplateId } from './uiModel';

export interface TemplateDef {
  id: TemplateId;
  title: string;
  subtitle: string;
  governingSections: string[];
  body: (draft: BoardResolutionDraft) => string[];
}

const PLACEHOLDER = '__________';

function rupees(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return PLACEHOLDER;
  return `₹${n.toLocaleString('en-IN')}`;
}

function asDate(d?: string): string {
  return d && d.length > 0 ? d : PLACEHOLDER;
}

function asText(s?: string): string {
  return s && s.length > 0 ? s : PLACEHOLDER;
}

const DESIGNATION_LABELS: Record<string, string> = {
  additional: 'Additional Director',
  executive: 'Executive Director',
  non_executive: 'Non-Executive Director',
  independent: 'Independent Director',
  whole_time: 'Whole-time Director',
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  current: 'Current Account',
  cash_credit: 'Cash Credit Account',
  overdraft: 'Overdraft Account',
  savings: 'Savings Account',
};

const appointmentTemplate: TemplateDef = {
  id: 'appointment_of_director',
  title: 'Appointment of Director',
  subtitle: 'Companies Act 2013, §152 / §161',
  governingSections: [
    'Section 152, Companies Act 2013',
    'Section 161, Companies Act 2013',
    'Rule 8, Companies (Appointment and Qualification of Directors) Rules, 2014',
  ],
  body: (d) => {
    const a = d.appointment ?? {};
    const designation = DESIGNATION_LABELS[a.designation ?? 'additional'];
    return [
      `RESOLVED THAT pursuant to the provisions of Section 152 and other applicable provisions of the Companies Act, 2013 read with Rule 8 of the Companies (Appointment and Qualification of Directors) Rules, 2014, and the Articles of Association of the Company, Mr./Ms. ${asText(a.directorName)}, having Director Identification Number (DIN) ${asText(a.din)}, who has provided his/her consent in writing in Form DIR-2 and submitted the declaration in Form DIR-8 confirming that he/she is not disqualified from being appointed as a director, be and is hereby appointed as a ${designation} of the Company with effect from ${asDate(a.appointmentDate)}.`,
      `RESOLVED FURTHER THAT the consent in Form DIR-2 and the declaration in Form DIR-8 received from Mr./Ms. ${asText(a.directorName)} be and are hereby taken on record.`,
      `RESOLVED FURTHER THAT Form DIR-12 be filed with the Registrar of Companies within thirty (30) days of such appointment, and any Director or the Company Secretary be and is hereby severally authorised to sign the said form, affix their Digital Signature thereon, and take all such steps as may be necessary, desirable, or expedient to give effect to the above resolution.`,
    ];
  },
};

const bankAccountTemplate: TemplateDef = {
  id: 'bank_account_opening',
  title: 'Opening of Bank Account',
  subtitle: 'Companies Act 2013, §179(3)(d)',
  governingSections: ['Section 179(3)(d), Companies Act 2013'],
  body: (d) => {
    const b = d.bankAccount ?? {};
    const c = d.company ?? {};
    const accountType = ACCOUNT_TYPE_LABELS[b.accountType ?? 'current'];

    const sigs = b.signatories ?? [];
    const signatoryLines = sigs.length === 0
      ? [`${PLACEHOLDER} (designation: ${PLACEHOLDER}, operating mode: ${PLACEHOLDER})`]
      : sigs.map((s) => `${asText(s.name)} (${asText(s.designation)}, operating ${s.mode === 'jointly' ? 'jointly' : 'singly'})`);

    return [
      `RESOLVED THAT pursuant to the provisions of Section 179(3)(d) of the Companies Act, 2013 and the Articles of Association of the Company, the consent of the Board of Directors of ${asText(c.name)} be and is hereby accorded for opening a ${accountType} in the name of the Company with ${asText(b.bankName)}, ${asText(b.branch)} Branch${b.ifsc ? ` (IFSC: ${b.ifsc})` : ''}, for the purpose of ${asText(b.purpose)}.`,
      `RESOLVED FURTHER THAT the following person(s) be and are hereby authorised to operate the said bank account on behalf of the Company:\n${signatoryLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
      `RESOLVED FURTHER THAT the said bank be and is hereby requested to honour all cheques, drafts, bills of exchange, promissory notes, and other instruments drawn, accepted, or made on behalf of the Company by the above-named authorised signatories, and to act on any instructions given in relation to the said account.`,
      `RESOLVED FURTHER THAT a certified true copy of this resolution together with a list of authorised signatories and their specimen signatures be furnished to the said bank, and that any Director of the Company be and is hereby severally authorised to do all such acts, deeds, and things as may be necessary to give effect to the above resolution.`,
    ];
  },
};

const borrowingTemplate: TemplateDef = {
  id: 'borrowing_powers',
  title: 'Borrowing Powers',
  subtitle: 'Companies Act 2013, §179(3)(d) / §180(1)(c)',
  governingSections: [
    'Section 179(3)(d), Companies Act 2013',
    'Section 180(1)(c), Companies Act 2013 (where borrowings exceed paid-up capital + free reserves)',
  ],
  body: (d) => {
    const b = d.borrowing ?? {};
    const c = d.company ?? {};
    return [
      `RESOLVED THAT pursuant to the provisions of Section 179(3)(d) and, to the extent applicable, Section 180(1)(c) of the Companies Act, 2013 read with the Companies (Meetings of Board and its Powers) Rules, 2014, and subject to the approval of the members of the Company where required, the consent of the Board of Directors of ${asText(c.name)} be and is hereby accorded to borrow monies from ${asText(b.lenderName)} for the purpose of ${asText(b.purpose)}, for an amount not exceeding ${rupees(b.ceiling)} in aggregate, on such terms and conditions as may be agreed upon between the Company and the lender.`,
      `RESOLVED FURTHER THAT ${asText(b.authorisedOfficerName)}, ${asText(b.authorisedOfficerDesignation)} of the Company, be and is hereby authorised to negotiate, finalise, sign, execute, and deliver the loan agreement, promissory notes, hypothecation deeds, security documents, and any other papers and documents as may be required in connection with the aforesaid borrowing, and to do all such acts, deeds, matters, and things as may be necessary, proper, desirable, or expedient to give effect to the above resolution.`,
      `RESOLVED FURTHER THAT a certified true copy of this resolution be furnished to the lender and to any other authority as may be required.`,
    ];
  },
};

const allotmentTemplate: TemplateDef = {
  id: 'share_allotment',
  title: 'Allotment of Shares',
  subtitle: 'Companies Act 2013, §42 r/w Rule 14 / §62',
  governingSections: [
    'Section 42, Companies Act 2013',
    'Section 62, Companies Act 2013',
    'Rule 14, Companies (Prospectus and Allotment of Securities) Rules, 2014',
  ],
  body: (d) => {
    const a = d.allotment ?? {};
    const c = d.company ?? {};
    const issuePrice = (a.faceValue ?? 0) + (a.premium ?? 0);

    const allottees = a.allottees ?? [];
    const allotteeLines = allottees.length === 0
      ? [`${PLACEHOLDER} (PAN: ${PLACEHOLDER}) — ${PLACEHOLDER} shares for ${PLACEHOLDER}`]
      : allottees.map((x) => `${asText(x.name)} (PAN: ${asText(x.pan)}) — ${typeof x.shares === 'number' ? x.shares.toLocaleString('en-IN') : PLACEHOLDER} equity shares for ${rupees(x.consideration)}`);

    return [
      `RESOLVED THAT pursuant to the provisions of Section 42 read with Rule 14 of the Companies (Prospectus and Allotment of Securities) Rules, 2014, and Section 62 of the Companies Act, 2013 and other applicable provisions, if any, and in accordance with the Articles of Association of the Company, the consent of the Board of Directors of ${asText(c.name)} be and is hereby accorded to allot ${typeof a.numberOfShares === 'number' ? a.numberOfShares.toLocaleString('en-IN') : PLACEHOLDER} equity shares of face value ${rupees(a.faceValue)} each at a premium of ${rupees(a.premium)} per share (total issue price ${rupees(issuePrice)} per share), to the following allottee(s):\n${allotteeLines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
      `RESOLVED FURTHER THAT the consideration for the said allotment has been received by way of ${a.considerationMode === 'other' ? 'other than cash' : 'cash through banking channels'}, and the share certificates in respect of the said allotment be issued to the allottee(s) under the common seal (if any) of the Company or under the signature of two Directors or one Director and the Company Secretary, as applicable.`,
      `RESOLVED FURTHER THAT the Return of Allotment in Form PAS-3 be filed with the Registrar of Companies within thirty (30) days of such allotment, and that any Director or the Company Secretary be and is hereby severally authorised to sign the said form, affix their Digital Signature thereon, and take all such steps as may be necessary to give effect to the above resolution.`,
    ];
  },
};

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  appointment_of_director: appointmentTemplate,
  bank_account_opening: bankAccountTemplate,
  borrowing_powers: borrowingTemplate,
  share_allotment: allotmentTemplate,
};

export const TEMPLATE_LIST: TemplateDef[] = [
  appointmentTemplate,
  bankAccountTemplate,
  borrowingTemplate,
  allotmentTemplate,
];
