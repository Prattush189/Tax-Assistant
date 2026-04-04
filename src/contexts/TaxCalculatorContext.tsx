import React, { createContext, useContext, useState, useMemo } from 'react';
import { calculateIncomeTax } from '../lib/taxEngine';
import type { IncomeTaxResult } from '../lib/taxEngine';
import { getTaxRules } from '../data/taxRules';
import type { AgeCategory } from '../types';

type FY = '2025-26' | '2024-25';

const deductionsInitial = {
  section80C: '',
  section80D_self: '',
  section80D_parents: '',
  section80CCD1B: '',
  isSelfSenior: false,
  isParentsSenior: false,
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
}

const TaxCalculatorContext = React.createContext<TaxCalculatorState | null>(null);

export function TaxCalculatorProvider({ children }: { children: React.ReactNode }) {
  const [fy, setFy] = useState<FY>('2025-26');
  const [grossSalary, setGrossSalary] = useState('');
  const [otherIncome, setOtherIncome] = useState('');
  const [ageCategory, setAgeCategory] = useState<AgeCategory>('below60');

  const [showDeductions, setShowDeductions] = useState(false);
  const [deductions, setDeductions] = useState(deductionsInitial);

  const [showHRA, setShowHRA] = useState(false);
  const [hra, setHra] = useState(hraInitial);

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
