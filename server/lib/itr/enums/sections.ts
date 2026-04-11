/* eslint-disable */
/**
 * Auto-generated from CBDT ITR JSON schema.
 * Do not edit manually — run `npm run itr:enums` instead.
 * TDS section codes referenced in ITR schemas. Aligned with tdsEngine.ts sections where possible.
 */

export interface ItrEnumOption {
  code: string;
  label: string;
}

export const TDS_SECTIONS: readonly ItrEnumOption[] = [
  { code: "192A", label: "192A/2AA- TDS on PF withdrawal" },
  { code: "193", label: "193- Interest on Securities" },
  { code: "194", label: "194- Dividends" },
  { code: "195", label: "195- Other sums payable to a non-resident" },
  { code: "4", label: "IA:194I(a)/4IA- Rent on hiring of plant and machinery" },
  { code: "4BA1", label: "194LBA(a)/BA1- Certain income in the form of interest from units of a business trust to a resident unit holder" },
  { code: "4BA2", label: "194LBA(b)/BA2- Certain income in the form of dividend from units of a business trust to a resident unit holder" },
  { code: "4BB", label: "194BB- Winning from horse race" },
  { code: "4DA", label: "194DA- Payment in respect of life insurance policy" },
  { code: "4EE", label: "194EE- Payments in respect of deposits under National Savings" },
  { code: "4F", label: "194F/94F- Payments on account of repurchase of units by Mutual Fund or Unit Trust of India" },
  { code: "4G", label: "194G/94G- Commission, price, etc. on sale of lottery tickets" },
  { code: "4H", label: "194H/94H- Commission or brokerage" },
  { code: "4IA", label: "194IA/9IA- TDS on Sale of immovable property" },
  { code: "4IB", label: "194IB/9IB- Payment of rent by certain individuals or Hindu undivided" },
  { code: "4IC", label: "194IC- Payment under specified agreement" },
  { code: "4LA", label: "194LA- Payment of compensation on acquisition of certain immovable" },
  { code: "4LB", label: "194LB- Income by way of Interest from Infrastructure Debt fund" },
  { code: "4LC1", label: "194LC/LC1- 194LC (2)(i) and (ia) Income under clause (i) and (ia) of sub-section (2) of section 194LC" },
  { code: "4LC2", label: "194LC/LC2- 194LC (2)(ib) Income under clause (ib) of sub-section (2) of section 194LC" },
  { code: "4LC3", label: "194LC/LC3- 194LC (2)(ic) Income under clause (ic) of sub-section (2) of section 194LC" },
  { code: "4LD", label: "194LD- TDS on interest on bonds / government securities" },
  { code: "92A", label: "192- Salary-Payment to Government employees other than Indian Government employees" },
  { code: "92B", label: "192- Salary-Payment to employees other than Government employees" },
  { code: "92C", label: "192- Salary-Payment to Indian Government employees" },
  { code: "94A", label: "194A- Interest other than 'Interest on securities'" },
  { code: "94B", label: "194B- Winning from lottery or crossword puzzle" },
  { code: "94BA", label: "194BA- Winnings from online games" },
  { code: "94C", label: "194C- Payments to contractors and sub-contractors" },
  { code: "94D", label: "194D- Insurance commission" },
  { code: "94E", label: "194E- Payments to non-resident sportsmen or sports associations" },
  { code: "94J", label: "A:194J(a)/4JA - Fees for technical services" },
  { code: "94K", label: "194K- Income payable to a resident assessee in respect of units of a specified mutual fund or of the units of the Unit Trust of India" },
  { code: "94M", label: "194M- Payment of certain sums by certain individuals or HUF" },
  { code: "94N", label: "194N- Payment of certain amounts in cash other than cases covered by first proviso or third proviso" },
  { code: "94O", label: "194O- Payment of certain sums by e-commerce operator to e-commerce participant." },
  { code: "94P", label: "194P- Deduction of tax in case of specified senior citizen" },
  { code: "94Q", label: "194Q- Deduction of tax at source on payment of certain sum for purchase of goods" },
  { code: "94R", label: "194R- Benefits or perquisites of business or profession" },
  { code: "94S", label: "194S- Payment of consideration for transfer of virtual digital asset by persons other than specified persons" },
  { code: "96A", label: "196A- Income in respect of units of non-residents" },
  { code: "96B", label: "196B- Payments in respect of units to an offshore fund" },
  { code: "96C", label: "196C- Income from foreign currency bonds or shares of Indian" },
  { code: "96D", label: "196D- Income of foreign institutional investors from securities" },
  { code: "96DA", label: "196D(1A)/6DA- Income of specified fund from securities" },
  { code: "LBA1", label: "194LBA(a)/BA1- 194LBA(a) income referred to in section 10(23FC)(a) from units of a business trust-NR" },
  { code: "LBA2", label: "194LBA(b)/BA2-194LBA(b) Income referred to in section 10(23FC)(b) from units of a business trust-NR" },
  { code: "LBA3", label: "194LBA(c)/BA3- 194LBA(c) Income referred to in section 10(23FCA) from units of a business trust-NR" },
  { code: "LBB", label: "194LBB- Income in respect of units of investment fund" },
  { code: "LBC", label: "194LBC- Income in respect of investment in securitization trust" },
] as const;

export type TDS_SECTIONSCode = typeof TDS_SECTIONS[number]['code'];
