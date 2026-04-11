// Source: incometax.gov.in/iec/foportal/help/individual/return-applicable-1
// Finance Act 2025 — verified 2026-04-04
import type { TaxRules } from '../../types';

export const FY_2025_26: TaxRules = {
  fy: '2025-26',
  newRegime: {
    standardDeduction: 75000,
    rebate87A: { maxRebate: 60000, incomeThreshold: 1200000 },
    slabs: [
      { upTo: 400000,   rate: 0    },
      { upTo: 800000,   rate: 0.05 },
      { upTo: 1200000,  rate: 0.10 },
      { upTo: 1600000,  rate: 0.15 },
      { upTo: 2000000,  rate: 0.20 },
      { upTo: 2400000,  rate: 0.25 },
      { upTo: Infinity, rate: 0.30 },
    ],
  },
  oldRegime: {
    standardDeduction: 50000,
    rebate87A: { maxRebate: 12500, incomeThreshold: 500000 },
    slabs: {
      below60: [
        { upTo: 250000,   rate: 0    },
        { upTo: 500000,   rate: 0.05 },
        { upTo: 1000000,  rate: 0.20 },
        { upTo: Infinity, rate: 0.30 },
      ],
      senior60to80: [
        { upTo: 300000,   rate: 0    },
        { upTo: 500000,   rate: 0.05 },
        { upTo: 1000000,  rate: 0.20 },
        { upTo: Infinity, rate: 0.30 },
      ],
      superSenior80plus: [
        { upTo: 500000,   rate: 0    },
        { upTo: 1000000,  rate: 0.20 },
        { upTo: Infinity, rate: 0.30 },
      ],
    },
    deductionLimits: {
      section80C: 150000,
      section80D_self: 25000,
      section80D_self_senior: 50000,
      section80D_parents: 25000,
      section80D_parents_senior: 50000,
      section80CCD1B: 50000,
      section80E: Infinity,
      section80G: Infinity,
      section80TTA: 10000,
      section80TTA_senior: 50000,
      section24b: 200000,
      section80EEB: 150000,
    },
  },
  cess: 0.04,
  surcharge: {
    // New regime caps at 25% above ₹5Cr (Finance Act 2023)
    new: [
      { above: 5_000_000,  rate: 0.10 }, // > ₹50L
      { above: 10_000_000, rate: 0.15 }, // > ₹1Cr
      { above: 20_000_000, rate: 0.25 }, // > ₹2Cr
    ],
    // Old regime retains 37% for > ₹5Cr
    old: [
      { above: 5_000_000,  rate: 0.10 }, // > ₹50L
      { above: 10_000_000, rate: 0.15 }, // > ₹1Cr
      { above: 20_000_000, rate: 0.25 }, // > ₹2Cr
      { above: 50_000_000, rate: 0.37 }, // > ₹5Cr
    ],
  },
  capitalGains: {
    equity: {
      ltcg: { rate: 0.125, holdingMonths: 12, exemption: 125000 },
      stcg: { rate: 0.20,  holdingMonths: 12 },
    },
    realEstate: {
      ltcg: { rate: 0.125, holdingMonths: 24, indexationOptionForPreJuly2024: true },
      stcg: { rate: 'slab', holdingMonths: 24 },
    },
    other: {
      ltcg: { rate: 0.125, holdingMonths: 24 },
      stcg: { rate: 'slab', holdingMonths: 24 },
    },
  },
  gst: {
    ratesAvailable: [0, 5, 18, 40],
    specialRates: [3, 0.25],
  },
};
