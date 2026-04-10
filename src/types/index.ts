export interface SectionReference {
  source: string;
  section: string;
  label: string;
  text: string;
  pdfFile?: string;
  pdfFiles?: { label: string; file: string }[];
}

export interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
  attachment?: {
    filename: string;
    mimeType: string;
  };
  attachments?: {
    filename: string;
    mimeType: string;
  }[];
  truncated?: boolean;
  references?: SectionReference[];
  profileRef?: string;  // profile name referenced in this message
}

export interface UploadResponse {
  success: boolean;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractedData: DocumentSummary;
}

export interface DocumentSummary {
  documentType: string | null;
  financialYear: string | null;
  employerName: string | null;
  employeeName: string | null;
  pan: string | null;
  grossSalary: number | null;
  standardDeduction: number | null;
  taxableSalary: number | null;
  tdsDeducted: number | null;
  deductions80C: number | null;
  deductions80D: number | null;
  otherDeductions: number | null;
  summary: string;
}

export interface DocumentContext {
  filename: string;
  mimeType: string;
  extractedData: DocumentSummary;
}

// ── Tax Calculator Types ──────────────────────────────────────────────────

export interface Slab {
  upTo: number;   // Infinity for the top slab
  rate: number;   // 0.05 = 5%
}

export interface Rebate87A {
  maxRebate: number;        // e.g. 60000 for FY 2025-26 new regime
  incomeThreshold: number;  // e.g. 1200000 (₹12L)
}

export interface DeductionLimits {
  section80C: number;
  section80D_self: number;
  section80D_self_senior: number;
  section80D_parents: number;
  section80D_parents_senior: number;
  section80CCD1B: number;
  // Extended deductions
  section80E?: number;          // Education loan interest (Infinity = no limit)
  section80G?: number;          // Donations
  section80TTA?: number;        // Savings interest (₹10K)
  section80TTA_senior?: number; // 80TTB for seniors (₹50K)
  section24b?: number;          // Home loan interest (₹2L)
  section80EEB?: number;        // EV loan interest (₹1.5L)
}

export interface OldRegimeSlabs {
  below60: Slab[];
  senior60to80: Slab[];
  superSenior80plus: Slab[];
}

export interface NewRegimeConfig {
  standardDeduction: number;
  rebate87A: Rebate87A;
  slabs: Slab[];
}

export interface OldRegimeConfig {
  standardDeduction: number;
  rebate87A: Rebate87A;
  slabs: OldRegimeSlabs;
  deductionLimits: DeductionLimits;
}

export interface CapitalGainsAssetRules {
  ltcg: {
    rate: number;
    holdingMonths: number;
    exemption?: number;
    indexationOptionForPreJuly2024?: boolean;
  };
  stcg: {
    rate: number | 'slab';
    holdingMonths: number;
  };
}

export interface CapitalGainsRules {
  equity: CapitalGainsAssetRules;
  realEstate: CapitalGainsAssetRules;
  other: CapitalGainsAssetRules;
}

export interface GstRules {
  ratesAvailable: number[];
  specialRates: number[];
}

export interface TaxRules {
  fy: string;
  newRegime: NewRegimeConfig;
  oldRegime: OldRegimeConfig;
  cess: number;
  capitalGains: CapitalGainsRules;
  gst: GstRules;
}

export type AgeCategory = 'below60' | 'senior60to80' | 'superSenior80plus';
export type TaxRegime = 'new' | 'old';
export type CapitalGainsAssetType = 'equity' | 'realEstate' | 'other';
export type GstTransactionType = 'intraState' | 'interState';
