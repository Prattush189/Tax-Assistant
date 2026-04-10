/**
 * Investment Planner — suggests optimal investment mix to maximize tax savings.
 * Pure function for basic suggestions; AI-powered suggestions via API.
 */

export interface InvestmentSuggestion {
  section: string;          // "80C", "80D", "24(b)", "80CCD(1B)"
  instrument: string;       // "ELSS Mutual Fund", "PPF", "NPS"
  suggestedAmount: number;
  maxLimit: number;
  currentlyUsed: number;
  remainingRoom: number;
  estimatedSaving: number;  // tax saved at marginal rate
  priority: number;         // 1 = highest
  description: string;
}

export interface InvestmentPlannerInput {
  taxableIncome: number;
  marginalRate: number;       // e.g., 0.30 for 30% slab
  currentDeductions: {
    section80C?: number;
    section80D_self?: number;
    section80D_parents?: number;
    section80CCD1B?: number;
    section24b?: number;
    section80E?: number;
  };
  ageCategory: 'below60' | 'senior60to80' | 'superSenior80plus';
}

export interface InvestmentPlannerResult {
  suggestions: InvestmentSuggestion[];
  totalPotentialSaving: number;
  totalSuggestedInvestment: number;
}

export function generateInvestmentSuggestions(input: InvestmentPlannerInput): InvestmentPlannerResult {
  const { marginalRate, currentDeductions, ageCategory } = input;
  const suggestions: InvestmentSuggestion[] = [];

  const isSenior = ageCategory !== 'below60';

  // 80C — ₹1.5L limit
  const used80C = currentDeductions.section80C ?? 0;
  const room80C = Math.max(0, 150000 - used80C);
  if (room80C > 0) {
    suggestions.push({
      section: '80C',
      instrument: 'ELSS Mutual Fund / PPF / EPF',
      suggestedAmount: room80C,
      maxLimit: 150000,
      currentlyUsed: used80C,
      remainingRoom: room80C,
      estimatedSaving: Math.round(room80C * marginalRate * 1.04), // + cess
      priority: 1,
      description: 'Invest in ELSS (3yr lock-in, market returns) or PPF (15yr, guaranteed 7.1%). Most popular deduction.',
    });
  }

  // 80CCD(1B) — NPS ₹50K additional
  const usedNPS = currentDeductions.section80CCD1B ?? 0;
  const roomNPS = Math.max(0, 50000 - usedNPS);
  if (roomNPS > 0) {
    suggestions.push({
      section: '80CCD(1B)',
      instrument: 'National Pension System (NPS)',
      suggestedAmount: roomNPS,
      maxLimit: 50000,
      currentlyUsed: usedNPS,
      remainingRoom: roomNPS,
      estimatedSaving: Math.round(roomNPS * marginalRate * 1.04),
      priority: 2,
      description: 'Additional ₹50K deduction over 80C. Long-term retirement savings with market-linked returns.',
    });
  }

  // 80D — Health insurance
  const selfLimit = isSenior ? 50000 : 25000;
  const parentLimit = 25000; // assume non-senior parents
  const usedSelf = currentDeductions.section80D_self ?? 0;
  const usedParents = currentDeductions.section80D_parents ?? 0;
  const roomSelf = Math.max(0, selfLimit - usedSelf);
  const roomParents = Math.max(0, parentLimit - usedParents);
  if (roomSelf + roomParents > 0) {
    suggestions.push({
      section: '80D',
      instrument: 'Health Insurance Premium',
      suggestedAmount: roomSelf + roomParents,
      maxLimit: selfLimit + parentLimit,
      currentlyUsed: usedSelf + usedParents,
      remainingRoom: roomSelf + roomParents,
      estimatedSaving: Math.round((roomSelf + roomParents) * marginalRate * 1.04),
      priority: 3,
      description: `Self: ₹${(selfLimit/1000).toFixed(0)}K limit, Parents: ₹${(parentLimit/1000).toFixed(0)}K. Essential protection + tax benefit.`,
    });
  }

  // 24(b) — Home loan interest ₹2L
  const used24b = currentDeductions.section24b ?? 0;
  const room24b = Math.max(0, 200000 - used24b);
  if (room24b > 0 && used24b > 0) { // only suggest if they already have a home loan
    suggestions.push({
      section: '24(b)',
      instrument: 'Home Loan Interest',
      suggestedAmount: room24b,
      maxLimit: 200000,
      currentlyUsed: used24b,
      remainingRoom: room24b,
      estimatedSaving: Math.round(room24b * marginalRate * 1.04),
      priority: 4,
      description: 'Interest on home loan for self-occupied property. Up to ₹2L deduction.',
    });
  }

  // Sort by priority
  suggestions.sort((a, b) => a.priority - b.priority);

  const totalPotentialSaving = suggestions.reduce((sum, s) => sum + s.estimatedSaving, 0);
  const totalSuggestedInvestment = suggestions.reduce((sum, s) => sum + s.suggestedAmount, 0);

  return { suggestions, totalPotentialSaving, totalSuggestedInvestment };
}
