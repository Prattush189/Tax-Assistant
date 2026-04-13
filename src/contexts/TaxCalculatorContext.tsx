import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { calculateIncomeTax, computeTaxForCategory } from '../lib/taxEngine';
import type { IncomeTaxResult } from '../lib/taxEngine';
import { getTaxRules } from '../data/taxRules';
import type { AgeCategory, TaxpayerCategory } from '../types';
import { useAuth } from './AuthContext';
import {
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  TaxProfileData,
} from '../services/api';
import { getTdsSectionsForCategory } from '../lib/tdsEngine';

import { SUPPORTED_FY } from '../data/taxRules';
import type {
  TdsFY,
  TdsCategory,
  DeductionType,
  PayeeStatus,
} from '../lib/tdsEngine';
import type { CapitalGainsAssetType, GstTransactionType } from '../types';

type FY = typeof SUPPORTED_FY[number];

/* ---------- Per-tab state slices ------------------------------------------
 * Lifted from each tab's local useState so that tab switches within
 * CalculatorView don't lose the user's work, and profile save/load can
 * read all tabs uniformly. See .planning/sessions/validated-greeting-matsumoto
 * plan for the bug fix context.
 */

export interface TdsTabState {
  fy: TdsFY;
  category: TdsCategory;
  sectionId: string;
  amount: string;
  hasPAN: boolean;
  deductionType: DeductionType;
  aggregatePaid: string;
  lowerRatePct: string;
  payeeStatus: PayeeStatus;
}

export interface CapitalGainsTabState {
  fy: '2025-26' | '2024-25';
  assetType: CapitalGainsAssetType;
  salePrice: string;
  purchasePrice: string;
  holdingMonths: string;
  acquisitionBeforeJuly2024: boolean;
  indexedCost: string;
}

export interface GstTabState {
  amount: string;
  rate: number;
  transactionType: GstTransactionType;
  amountIncludesGST: boolean;
}

export interface AdvanceTaxTabState {
  fy: string;
  estimatedIncome: string;
  tdsDeducted: string;
  selfAssessment: string;
}

export interface SalaryOptTabState {
  fy: string;
  ctc: string;
  monthlyRent: string;
  isMetro: boolean;
}

const deductionsInitial = {
  section80C: '',
  section80D_self: '',
  section80D_parents: '',
  section80CCD1B: '',
  isSelfSenior: false,
  isParentsSenior: false,
  // Extended deductions
  section80E: '',
  section80G: '',
  section80TTA: '',
  section24b: '',
  section80EEB: '',
};

const hraInitial = {
  actualHRA: '',
  basicPlusDa: '',
  rentPaid: '',
  isMetroCity: false,
};

interface TaxCalculatorState {
  fy: FY;
  setFy: React.Dispatch<React.SetStateAction<FY>>;
  taxpayerCategory: TaxpayerCategory;
  setTaxpayerCategory: React.Dispatch<React.SetStateAction<TaxpayerCategory>>;
  grossSalary: string;
  setGrossSalary: React.Dispatch<React.SetStateAction<string>>;
  otherIncome: string;
  setOtherIncome: React.Dispatch<React.SetStateAction<string>>;
  ageCategory: AgeCategory;
  setAgeCategory: React.Dispatch<React.SetStateAction<AgeCategory>>;
  showDeductions: boolean;
  setShowDeductions: React.Dispatch<React.SetStateAction<boolean>>;
  deductions: typeof deductionsInitial;
  setDeductions: React.Dispatch<React.SetStateAction<typeof deductionsInitial>>;
  showHRA: boolean;
  setShowHRA: React.Dispatch<React.SetStateAction<boolean>>;
  hra: typeof hraInitial;
  setHra: React.Dispatch<React.SetStateAction<typeof hraInitial>>;
  oldResult: IncomeTaxResult;
  newResult: IncomeTaxResult;
  // Profile management
  currentProfileId: string | null;
  currentProfileName: string;
  profiles: TaxProfileData[];
  profileLimit: number;
  saveProfile: (name: string) => Promise<void>;
  loadProfile: (profile: TaxProfileData) => void;
  deleteCurrentProfile: () => Promise<void>;
  loadProfiles: () => Promise<void>;
  clearProfile: () => void;
  // Per-tab state (lifted to survive tab switches)
  tdsTabState: TdsTabState;
  setTdsTabState: React.Dispatch<React.SetStateAction<TdsTabState>>;
  cgTabState: CapitalGainsTabState;
  setCgTabState: React.Dispatch<React.SetStateAction<CapitalGainsTabState>>;
  gstTabState: GstTabState;
  setGstTabState: React.Dispatch<React.SetStateAction<GstTabState>>;
  advanceTaxTabState: AdvanceTaxTabState;
  setAdvanceTaxTabState: React.Dispatch<React.SetStateAction<AdvanceTaxTabState>>;
  salaryOptTabState: SalaryOptTabState;
  setSalaryOptTabState: React.Dispatch<React.SetStateAction<SalaryOptTabState>>;
}

const TaxCalculatorContext = React.createContext<TaxCalculatorState | null>(null);

export function TaxCalculatorProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [fy, setFy] = useState<FY>('2025-26');
  const [taxpayerCategory, setTaxpayerCategory] = useState<TaxpayerCategory>('Individual');
  const [grossSalary, setGrossSalary] = useState('');
  const [otherIncome, setOtherIncome] = useState('');
  const [ageCategory, setAgeCategory] = useState<AgeCategory>('below60');

  const [showDeductions, setShowDeductions] = useState(false);
  const [deductions, setDeductions] = useState(deductionsInitial);

  const [showHRA, setShowHRA] = useState(false);
  const [hra, setHra] = useState(hraInitial);

  // Profile state
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [currentProfileName, setCurrentProfileName] = useState('');
  const [profiles, setProfiles] = useState<TaxProfileData[]>([]);
  const [profileLimit, setProfileLimit] = useState(1);

  // Per-tab state (lifted from each tab's local useState — see plan doc)
  const [tdsTabState, setTdsTabState] = useState<TdsTabState>(() => ({
    fy: '2025-26',
    category: 'resident',
    sectionId: getTdsSectionsForCategory('resident')[0].id,
    amount: '',
    hasPAN: true,
    deductionType: 'prescribed',
    aggregatePaid: '',
    lowerRatePct: '',
    payeeStatus: 'individual',
  }));

  const [cgTabState, setCgTabState] = useState<CapitalGainsTabState>({
    fy: '2025-26',
    assetType: 'equity',
    salePrice: '',
    purchasePrice: '',
    holdingMonths: '',
    acquisitionBeforeJuly2024: false,
    indexedCost: '',
  });

  const [gstTabState, setGstTabState] = useState<GstTabState>({
    amount: '',
    rate: 18,
    transactionType: 'intraState',
    amountIncludesGST: false,
  });

  const [advanceTaxTabState, setAdvanceTaxTabState] = useState<AdvanceTaxTabState>({
    fy: SUPPORTED_FY[0],
    estimatedIncome: '',
    tdsDeducted: '',
    selfAssessment: '',
  });

  const [salaryOptTabState, setSalaryOptTabState] = useState<SalaryOptTabState>({
    fy: SUPPORTED_FY[0],
    ctc: '',
    monthlyRent: '',
    isMetro: true,
  });

  const { oldResult, newResult } = useMemo(() => {
    const rules = getTaxRules(fy);
    const gross = Number(grossSalary) || 0;
    const other = Number(otherIncome) || 0;

    // For Firm/Company: no regime choice, no individual deductions
    if (taxpayerCategory === 'Firm' || taxpayerCategory === 'Company') {
      const taxableIncome = gross + other; // simplified — no std deduction for firms
      const result = computeTaxForCategory(taxableIncome, 'new', 'below60', taxpayerCategory, rules);
      // Both old and new are the same (no regime choice)
      const fullResult: IncomeTaxResult = {
        grossIncome: gross + other,
        standardDeduction: 0,
        hraExemption: 0,
        totalDeductions: 0,
        taxableIncome,
        ...result,
        effectiveRate: (gross + other) > 0 ? (result.totalTax / (gross + other)) * 100 : 0,
      };
      return { oldResult: fullResult, newResult: fullResult };
    }

    const hraInput = {
      actualHRA: Number(hra.actualHRA) || 0,
      basicPlusDa: Number(hra.basicPlusDa) || 0,
      rentPaid: Number(hra.rentPaid) || 0,
      isMetroCity: hra.isMetroCity,
    };

    const deductionInput = {
      section80C: Number(deductions.section80C) || 0,
      section80D_self: Number(deductions.section80D_self) || 0,
      section80D_parents: Number(deductions.section80D_parents) || 0,
      section80CCD1B: Number(deductions.section80CCD1B) || 0,
      isSelfSenior: deductions.isSelfSenior,
      isParentsSenior: deductions.isParentsSenior,
      section80E: Number(deductions.section80E) || 0,
      section80G: Number(deductions.section80G) || 0,
      section80TTA: Number(deductions.section80TTA) || 0,
      section24b: Number(deductions.section24b) || 0,
      section80EEB: Number(deductions.section80EEB) || 0,
    };

    const oldResult = calculateIncomeTax(
      {
        grossSalary: gross,
        otherIncome: other,
        fy,
        regime: 'old',
        ageCategory,
        category: taxpayerCategory,
        deductions: deductionInput,
        hra: hraInput,
      },
      rules,
    );

    const newResult = calculateIncomeTax(
      {
        grossSalary: gross,
        otherIncome: other,
        fy,
        regime: 'new',
        ageCategory,
        category: taxpayerCategory,
      },
      rules,
    );

    return { oldResult, newResult };
  }, [fy, taxpayerCategory, grossSalary, otherIncome, ageCategory, deductions, hra]);

  const loadProfiles = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await fetchProfiles();
      setProfiles(res.profiles);
      setProfileLimit(res.limit);
    } catch {
      // silently fail
    }
  }, [isAuthenticated]);

  const saveProfile = useCallback(async (name: string) => {
    const data = {
      name,
      fy,
      gross_salary: grossSalary,
      other_income: otherIncome,
      age_category: ageCategory,
      deductions_data: JSON.stringify(deductions),
      hra_data: JSON.stringify(hra),
    };
    if (currentProfileId) {
      await updateProfile(currentProfileId, data);
    } else {
      const profile = await createProfile(data);
      setCurrentProfileId(profile.id);
    }
    setCurrentProfileName(name);
    await loadProfiles();
  }, [fy, grossSalary, otherIncome, ageCategory, deductions, hra, currentProfileId, loadProfiles]);

  const loadProfile = useCallback((profile: TaxProfileData) => {
    setFy(profile.fy as FY);
    setGrossSalary(profile.gross_salary);
    setOtherIncome(profile.other_income);
    setAgeCategory(profile.age_category as AgeCategory);
    const ded = JSON.parse(profile.deductions_data);
    setDeductions(prev => ({ ...prev, ...ded }));
    const h = JSON.parse(profile.hra_data);
    setHra(prev => ({ ...prev, ...h }));
    setCurrentProfileId(profile.id);
    setCurrentProfileName(profile.name);
  }, []);

  const deleteCurrentProfile = useCallback(async () => {
    if (!currentProfileId) return;
    await deleteProfile(currentProfileId);
    setCurrentProfileId(null);
    setCurrentProfileName('');
    await loadProfiles();
  }, [currentProfileId, loadProfiles]);

  const clearProfile = useCallback(() => {
    setCurrentProfileId(null);
    setCurrentProfileName('');
  }, []);

  // Load profiles on mount when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadProfiles();
    }
  }, [isAuthenticated, loadProfiles]);

  return (
    <TaxCalculatorContext.Provider
      value={{
        fy,
        setFy,
        taxpayerCategory,
        setTaxpayerCategory,
        grossSalary,
        setGrossSalary,
        otherIncome,
        setOtherIncome,
        ageCategory,
        setAgeCategory,
        showDeductions,
        setShowDeductions,
        deductions,
        setDeductions,
        showHRA,
        setShowHRA,
        hra,
        setHra,
        oldResult,
        newResult,
        // Profile management
        currentProfileId,
        currentProfileName,
        profiles,
        profileLimit,
        saveProfile,
        loadProfile,
        deleteCurrentProfile,
        loadProfiles,
        clearProfile,
        // Per-tab state
        tdsTabState,
        setTdsTabState,
        cgTabState,
        setCgTabState,
        gstTabState,
        setGstTabState,
        advanceTaxTabState,
        setAdvanceTaxTabState,
        salaryOptTabState,
        setSalaryOptTabState,
      }}
    >
      {children}
    </TaxCalculatorContext.Provider>
  );
}

export function useTaxCalculator(): TaxCalculatorState {
  const ctx = useContext(TaxCalculatorContext);
  if (!ctx) {
    throw new Error('useTaxCalculator must be used inside TaxCalculatorProvider');
  }
  return ctx;
}
