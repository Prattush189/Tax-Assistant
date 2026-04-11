/* eslint-disable */
/**
 * Auto-generated from CBDT ITR JSON schema.
 * Do not edit manually — run `npm run itr:enums` instead.
 * Indian state codes (incl. UTs + 99:Foreign). Used in PersonalInfo.Address.StateCode and donee addresses.
 */

export interface ItrEnumOption {
  code: string;
  label: string;
}

export const STATES: readonly ItrEnumOption[] = [
  { code: "01", label: "Andaman and Nicobar islands" },
  { code: "02", label: "Andhra Pradesh" },
  { code: "03", label: "Arunachal Pradesh" },
  { code: "04", label: "Assam" },
  { code: "05", label: "Bihar" },
  { code: "06", label: "Chandigarh" },
  { code: "07", label: "Dadra Nagar and Haveli" },
  { code: "08", label: "Daman and Diu" },
  { code: "09", label: "Delhi" },
  { code: "10", label: "Goa" },
  { code: "11", label: "Gujarat" },
  { code: "12", label: "Haryana" },
  { code: "13", label: "Himachal Pradesh" },
  { code: "14", label: "Jammu and Kashmir" },
  { code: "15", label: "Karnataka" },
  { code: "16", label: "Kerala" },
  { code: "17", label: "Lakshadweep" },
  { code: "18", label: "Madhya Pradesh" },
  { code: "19", label: "Maharashtra" },
  { code: "20", label: "Manipur" },
  { code: "21", label: "meghalaya" },
  { code: "22", label: "Mizoram" },
  { code: "23", label: "Nagaland" },
  { code: "24", label: "Odisha" },
  { code: "25", label: "Puducherry" },
  { code: "26", label: "Punjab" },
  { code: "27", label: "Rajasthan" },
  { code: "28", label: "Sikkim" },
  { code: "29", label: "Tamil Nadu" },
  { code: "30", label: "Tripura" },
  { code: "31", label: "Uttar Pradesh" },
  { code: "32", label: "West Bengal" },
  { code: "33", label: "Chhattisgarh" },
  { code: "34", label: "Uttarakhand" },
  { code: "35", label: "Jharkhand" },
  { code: "36", label: "Telangana" },
  { code: "37", label: "Ladakh" },
  { code: "99", label: "Foreign" },
] as const;

export type STATESCode = typeof STATES[number]['code'];
