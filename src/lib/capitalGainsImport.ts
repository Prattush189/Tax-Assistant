/**
 * Capital gains statement import — parses broker CSV/Excel exports and computes STCG/LTCG.
 * Supports common Indian broker formats (Zerodha, Groww, Angel One).
 */
import Papa from 'papaparse';

export interface TradeEntry {
  symbol: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  holdingDays: number;
  pnl: number;
  type: 'STCG' | 'LTCG';
}

export interface CGSummary {
  trades: TradeEntry[];
  totalSTCG: number;
  totalLTCG: number;
  ltcgExemption: number;        // ₹1.25L for FY 2024-25+
  taxableSTCG: number;
  taxableLTCG: number;
  stcgTax: number;              // 20% for FY 2024-25+
  ltcgTax: number;              // 12.5% for FY 2024-25+
  totalTrades: number;
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  // Try DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const parts = s.includes('/') ? s.split('/') : s.includes('-') ? s.split('-') : [];
  if (parts.length !== 3) return null;
  if (parts[0].length === 4) return new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Parse a CSV string from a broker statement. Attempts to auto-detect columns.
 */
export function parseCapitalGainsCSV(csvText: string): CGSummary {
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const rows = result.data as Record<string, string>[];

  if (rows.length === 0) {
    return { trades: [], totalSTCG: 0, totalLTCG: 0, ltcgExemption: 125000, taxableSTCG: 0, taxableLTCG: 0, stcgTax: 0, ltcgTax: 0, totalTrades: 0 };
  }

  // Auto-detect column names (case-insensitive fuzzy match)
  const cols = Object.keys(rows[0]);
  const find = (patterns: string[]): string | undefined =>
    cols.find(c => patterns.some(p => c.toLowerCase().includes(p.toLowerCase())));

  const symbolCol = find(['symbol', 'scrip', 'stock', 'instrument', 'name', 'security']);
  const buyDateCol = find(['buy date', 'purchase date', 'buy_date', 'acquisition']);
  const sellDateCol = find(['sell date', 'sale date', 'sell_date', 'redemption']);
  const buyPriceCol = find(['buy price', 'purchase price', 'buy_price', 'cost', 'acquisition price', 'buy avg']);
  const sellPriceCol = find(['sell price', 'sale price', 'sell_price', 'sell avg', 'redemption price']);
  const qtyCol = find(['quantity', 'qty', 'units', 'shares']);
  const pnlCol = find(['pnl', 'p&l', 'profit', 'gain', 'realized']);

  const trades: TradeEntry[] = [];

  for (const row of rows) {
    const symbol = symbolCol ? (row[symbolCol] ?? '').trim() : '';
    const buyDateStr = buyDateCol ? row[buyDateCol] : '';
    const sellDateStr = sellDateCol ? row[sellDateCol] : '';
    const buyPrice = buyPriceCol ? Math.abs(parseFloat(row[buyPriceCol]) || 0) : 0;
    const sellPrice = sellPriceCol ? Math.abs(parseFloat(row[sellPriceCol]) || 0) : 0;
    const quantity = qtyCol ? Math.abs(parseFloat(row[qtyCol]) || 0) : 1;

    if (!symbol || (buyPrice === 0 && sellPrice === 0)) continue;

    const buyDate = parseDate(buyDateStr);
    const sellDate = parseDate(sellDateStr);
    const holdingDays = buyDate && sellDate ? daysBetween(buyDate, sellDate) : 0;

    let pnl: number;
    if (pnlCol && row[pnlCol]) {
      pnl = parseFloat(row[pnlCol]) || 0;
    } else {
      pnl = (sellPrice - buyPrice) * quantity;
    }

    // Equity: >12 months = LTCG, else STCG
    const type: 'STCG' | 'LTCG' = holdingDays > 365 ? 'LTCG' : 'STCG';

    trades.push({
      symbol,
      buyDate: buyDateStr,
      sellDate: sellDateStr,
      buyPrice,
      sellPrice,
      quantity,
      holdingDays,
      pnl,
      type,
    });
  }

  const totalSTCG = trades.filter(t => t.type === 'STCG').reduce((a, t) => a + t.pnl, 0);
  const totalLTCG = trades.filter(t => t.type === 'LTCG').reduce((a, t) => a + t.pnl, 0);
  const ltcgExemption = 125000;
  const taxableLTCG = Math.max(0, totalLTCG - ltcgExemption);
  const taxableSTCG = Math.max(0, totalSTCG); // losses can offset but simplified for now

  return {
    trades,
    totalSTCG,
    totalLTCG,
    ltcgExemption,
    taxableSTCG,
    taxableLTCG,
    stcgTax: Math.round(taxableSTCG * 0.20 * 1.04),  // 20% + 4% cess
    ltcgTax: Math.round(taxableLTCG * 0.125 * 1.04),  // 12.5% + 4% cess
    totalTrades: trades.length,
  };
}
