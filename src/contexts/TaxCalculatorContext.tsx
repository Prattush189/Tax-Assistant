import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { calculateIncomeTax } from '../lib/taxEngine';
import type { IncomeTaxResult } from '../lib/taxEngine';
import { getTaxRules } from '../data/taxRules';
import type { AgeCategory } from '../types';
import { useAuth } from './AuthContext';
import {
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  TaxProfileData,
} from '../services/api';

import { SUPPORTED_FY } from '../data/taxRules';

type FY = typeof SUPPORTED_FY[number];

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
}

const TaxCalculatorContext = React.createContext<TaxCalculatorState | null>(null);

export function TaxCalculatorProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [fy, setFy] = useState<FY>('2025-26');
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

  const { oldResult, newResult } = useMemo(() => {
    const rules = getTaxRules(fy);
    const gross = Number(grossSalary) || 0;
    const other = Number(otherIncome) || 0;

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
      // Extended deductions
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
      },
      rules,
    );

    return { oldResult, newResult };
  }, [fy, grossSalary, otherIncome, ageCategory, deductions, hra]);

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
