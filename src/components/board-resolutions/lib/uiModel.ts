/**
 * Board resolution wizard UI model.
 *
 * Each draft targets one of the 4 supported templates. Template-specific
 * sections live on the draft as optional sub-objects so switching template
 * mid-wizard doesn't wipe unrelated data (though in practice the picker
 * is only shown once at draft creation).
 */

export type TemplateId =
  | 'appointment_of_director'
  | 'bank_account_opening'
  | 'borrowing_powers'
  | 'share_allotment';

export interface CompanyBlock {
  name?: string;
  cin?: string;
  registeredOffice?: string;
  email?: string;
  phone?: string;
}

export interface MeetingBlock {
  date?: string;             // YYYY-MM-DD
  time?: string;             // HH:MM
  place?: string;
  directorsPresent?: number;
  quorumMet?: boolean;
}

export interface DirectorPresent {
  name?: string;
  din?: string;
}

export interface SignatoryBlock {
  chairpersonName?: string;
  certifiedBy?: {
    name?: string;
    designation?: string;
    din?: string;
  };
  directorsPresent?: DirectorPresent[];
}

export type DirectorDesignation =
  | 'additional'
  | 'executive'
  | 'non_executive'
  | 'independent'
  | 'whole_time';

export interface AppointmentBody {
  directorName?: string;
  din?: string;
  designation?: DirectorDesignation;
  appointmentDate?: string;
  dir2ConsentOnFile?: boolean;
  dir8DeclarationOnFile?: boolean;
}

export interface BankSignatory {
  name?: string;
  designation?: string;
  mode?: 'singly' | 'jointly';
}

export interface BankAccountBody {
  bankName?: string;
  branch?: string;
  ifsc?: string;
  accountType?: 'current' | 'cash_credit' | 'overdraft' | 'savings';
  purpose?: string;
  signatories?: BankSignatory[];
}

export interface BorrowingBody {
  ceiling?: number;
  lenderName?: string;
  purpose?: string;
  authorisedOfficerName?: string;
  authorisedOfficerDesignation?: string;
}

export interface Allottee {
  name?: string;
  pan?: string;
  shares?: number;
  consideration?: number;
}

export interface AllotmentBody {
  numberOfShares?: number;
  faceValue?: number;
  premium?: number;
  considerationMode?: 'cash' | 'other';
  allottees?: Allottee[];
}

export interface BoardResolutionDraft {
  templateId: TemplateId;
  company?: CompanyBlock;
  meeting?: MeetingBlock;
  signatories?: SignatoryBlock;
  appointment?: AppointmentBody;
  bankAccount?: BankAccountBody;
  borrowing?: BorrowingBody;
  allotment?: AllotmentBody;
}

export type StepId =
  | 'templatePicker'
  | 'company'
  | 'meeting'
  | 'body'
  | 'signatories'
  | 'review';

export const STEP_LABELS: Record<StepId, string> = {
  templatePicker: 'Template',
  company: 'Company',
  meeting: 'Meeting',
  body: 'Resolution',
  signatories: 'Signatories',
  review: 'Review & Export',
};

export const STEP_DESCRIPTIONS: Record<StepId, string> = {
  templatePicker: 'Pick the resolution template.',
  company: 'Company name, CIN, registered office.',
  meeting: 'Meeting date, time, place, and quorum.',
  body: 'Template-specific resolution details.',
  signatories: 'Chairperson, directors present, certifying director.',
  review: 'Preview and download the signed PDF.',
};

export function emptyDraft(templateId: TemplateId): BoardResolutionDraft {
  return { templateId };
}

export function getStepOrder(_t: TemplateId): StepId[] {
  return ['templatePicker', 'company', 'meeting', 'body', 'signatories', 'review'];
}

export const TEMPLATE_TITLES: Record<TemplateId, string> = {
  appointment_of_director: 'Appointment of Director',
  bank_account_opening: 'Bank Account Opening',
  borrowing_powers: 'Borrowing Powers',
  share_allotment: 'Share Allotment',
};
