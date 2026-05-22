/**
 * Smoke test for server/lib/bankClassifier.ts.
 *
 * Each test case is `{ narration, type, expect: { category, subcategory? } | null }`.
 * The cases come from BANK CHARGES FORMAT.xlsx (the user's wishlist)
 * plus realistic narrations sampled from actual statements (HDFC,
 * JKBank, ICICI dumps the smoke-test-bank-rules script produced).
 *
 * Run with:
 *   npx tsx scripts/smoke-test-bank-classifier.ts
 */

import { classifyRow, extractCounterparty, extractReference, markRecurring, unifyAmbiguousCounterparties, normalizeCounterpartyKey, validateDirectionCategory, applyRetailBusinessPromotion, classifyWithLearning, type LearnedRuleLike } from '../server/lib/bankClassifier';

interface Case {
  narration: string;
  type: 'credit' | 'debit';
  amount?: number;
  expect: { category: string; subcategory?: string | null } | null;
  expectCounterparty?: string | null;
  expectReference?: string | null;
}

const CASES: Case[] = [
  // ─── Bank Charges (xlsx anchor list) ────────────────────────
  { narration: 'ATM CHARGES QUARTERLY', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'ATM ANN.CHRG INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'ATM WDR', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'DEBIT ATM CARD', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'ATM' } },
  { narration: 'CHRGS/NEFT/MBK', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'CHRGS/IMPS/MBK', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'NEFT CHGS BRN INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'RTGS CHGS BRN INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'RTGS-GST-COMMISSION CHARGE', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'IMPS CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' } },
  { narration: 'SMS CHARGES MONTHLY', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'SMS' } },
  { narration: 'SMS CHRG FOR:01-01-2024to31-03-2024', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'SMS' } },
  { narration: 'MAB CHRG', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'Min Bal Chrgfrom 01-01-2024 to 31-03-2024', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'Avg bal Chgs Incl GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'MINIMUM BALANCE CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'LOAN_PROC', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Loan Processing' } },
  { narration: 'Loan Processing Fee', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Loan Processing' } },
  { narration: 'CIBIL', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'CIBIL' } },
  { narration: 'CHEQUE BOOK CHGS', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cheque' } },
  { narration: 'CHEQUE BOOK CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cheque' } },
  { narration: 'CHEQUE BOOK CHAREGS', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cheque' } },
  { narration: 'Cash Deposit Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cash Txn' } },
  { narration: 'CashDep Chgs', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cash Txn' } },
  { narration: 'Cash Txn Chgs-Branch', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Cash Txn' } },
  { narration: 'POS Rental', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'POS Rental' } },
  { narration: 'SoundBox Rent MAR-2026', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'SoundBox Rent' } },
  { narration: 'Penal Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Penal' } },
  { narration: 'Penal Cha', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Penal' } },
  { narration: 'Reject Insufficient Balance', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Penal' } },
  { narration: 'INSPC CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Inspection' } },
  { narration: 'Outward Rejection Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Rejection' } },
  { narration: 'Inward Rejection Charges', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Rejection' } },
  // YES Bank / HDFC wording — "INWARD CHQ RETURN CHRGS FOR 04-OCT-2025"
  // was tagged Other previously because the rule only matched the
  // "rejection" wording. Now both variants land in the same bucket.
  { narration: 'INWARD CHQ RETURN CHRGS FOR 04-OCT-2025', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Rejection' } },
  { narration: 'OUTWARD CHEQUE RETURN CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Rejection' } },
  { narration: 'DEBIT CARD ANNUAL FEE', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Card Fee' } },
  { narration: 'ADHOC STMT CHGS INCL GST', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },
  { narration: 'ACCT MAIN CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },
  { narration: 'INCIDENTAL CHARGES', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },
  { narration: 'LOW DENOMINATION CHARGE', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Other' } },

  // ─── Bank Interest ─────────────────────────────────────────
  { narration: '0277020100000092:Int.Coll:01-03-2026 to 31-03-2026', type: 'debit', expect: { category: 'Bank Interest (Dr)', subcategory: 'Loan Interest' } },
  // J&K Bank loan-interest narrations
  { narration: 'MARGIN TERM LOAN', type: 'debit', expect: { category: 'Bank Interest (Dr)', subcategory: 'Loan Interest' } },
  { narration: 'MARGIN', type: 'debit', expect: { category: 'Bank Interest (Dr)', subcategory: 'Loan Interest' } },
  { narration: 'PART PERIOD INTEREST', type: 'debit', expect: { category: 'Bank Interest (Dr)', subcategory: 'Loan Interest' } },
  // AMB CHARGES (J&K Bank's wording for Account Minimum Balance penalty)
  { narration: 'AMB CHARGES : FROMAMB CHARGE TO 01 -', type: 'debit', expect: { category: 'Bank Charges', subcategory: 'Min Balance' } },
  { narration: 'Int.Pd:01-04-2024 to 30-06-2024', type: 'credit', expect: { category: 'Bank Interest (Cr)', subcategory: 'Savings' } },
  { narration: 'CREDIT INTEREST', type: 'credit', expect: { category: 'Bank Interest (Cr)', subcategory: 'Savings' } },

  // ─── Insurance — distinct from INSPC ──────────────────────
  { narration: '8823938-1_PROPERTY_INS_ERGO_WC_RENEWAL_M', type: 'debit', expect: { category: 'Insurance', subcategory: 'Premium' } },
  { narration: 'INS-RENEWAL-PREMIUM-VEHICLE', type: 'debit', expect: { category: 'Insurance', subcategory: 'Premium' } },

  // ─── Mobile / Utilities ───────────────────────────────────
  { narration: 'BIL/BPAY/BSNL MOBILE', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'BSNL' } },
  { narration: 'BIL/BPAY/AIRTEL', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Airtel' } },
  { narration: 'BIL/BPAY/JIO', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Jio' } },
  { narration: 'PAYTMJIO RECHARGE', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Jio' } },
  { narration: 'BILL DK POWER DEVELOPMENT', type: 'debit', expect: { category: 'Electricity Charges', subcategory: 'DISCOM' } },
  { narration: 'BILL DKP ELECTRICITY', type: 'debit', expect: { category: 'Electricity Charges', subcategory: 'DISCOM' } },
  { narration: 'WATER BILL FEB', type: 'debit', expect: { category: 'Water Charges', subcategory: 'Municipal' } },

  // ─── Loan EMI / Salary / Rent ─────────────────────────────
  { narration: 'EMI 88588864 CHQ S885888640061', type: 'debit', expect: { category: 'Loan EMI' } },
  { narration: 'Loan Recovery For0060265240000147', type: 'debit', expect: { category: 'Loan EMI' } },
  { narration: 'NEFT-HDFC-SALARY MAR-N123456', type: 'credit', expect: { category: 'Salary' } },
  { narration: 'RENT FOR APRIL', type: 'credit', expect: { category: 'Rent Received' } },
  { narration: 'OFFICE RENT MARCH', type: 'debit', expect: { category: 'Business Expenses' } },

  // ─── Investments ─────────────────────────────────────────
  { narration: 'SIP HDFC EQUITY FUND', type: 'debit', expect: { category: 'Investments', subcategory: 'MF' } },
  { narration: 'ZERODHA-FUNDS-ADD', type: 'debit', expect: { category: 'Investments', subcategory: 'MF' } },
  { narration: 'GROWW INVESTMENT', type: 'debit', expect: { category: 'Investments', subcategory: 'MF' } },

  // ─── GST / TDS / Taxes ───────────────────────────────────
  { narration: 'GSTN-26AAAAA0000A1Z5-FEB2025', type: 'debit', expect: { category: 'GST Payments' } },
  { narration: 'TDS PAYMENT 26Q', type: 'debit', expect: { category: 'TDS' } },
  { narration: 'CHALLAN 280 ADV TAX FY25', type: 'debit', expect: { category: 'Taxes Paid', subcategory: 'Advance Tax' } },

  // ─── Transfers (personal counterparty) ────────────────────
  { narration: 'UPI/509077863301/FROM: rajabilalmatta.rb@okicici/TO: sf3458311-4@okaxis/UPI', type: 'credit', expect: { category: 'Transfers' } },
  { narration: 'mTFR/9682308046/AAMIR LIYAQAT', type: 'credit', expect: { category: 'Transfers' } },

  // ─── Transfers — business counterparty (declined → null) ──
  // These should fall through to AI because the counterparty looks
  // like a business (PAYTM PAYMENTS, ENTERPRISES suffix).
  { narration: 'RTGS-PAYTM PAYMENTS SERVICES LIMIT-YESB0000001', type: 'credit', expect: null },
  { narration: 'NEFT-HDFC-ABC ENTERPRISES PVT LTD-N987654', type: 'debit', expect: null },

  // ─── Cloud / SaaS (Business Expenses · Software) ──────────
  { narration: 'POS AWS *EC2 INSTANCES', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'AMAZON WEB SERVICES INDIA PVT LTD', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'GOOGLE CLOUD PLATFORM', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'GOOGLE WORKSPACE SUBSCRIPTION', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'MICROSOFT AZURE BILLING', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'GITHUB INC', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'FIGMA INC', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'SLACK TECHNOLOGIES', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'ZOHO CORPORATION', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'NOTION LABS', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'SHOPIFY INC', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },
  { narration: 'ADOBE SYSTEMS', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Software' } },

  // ─── Marketing / Ads (Business Expenses · Marketing) ────────
  { narration: 'GOOGLE ADS BILLING', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Marketing' } },
  { narration: 'META PLATFORMS IRELAND', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Marketing' } },
  { narration: 'LINKEDIN PREMIUM SALES NAV', type: 'debit', expect: { category: 'Business Expenses', subcategory: 'Marketing' } },

  // ─── E-commerce (Personal · E-commerce) ─────────────────────
  { narration: 'POS AMAZON.IN', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'UPI/123456/PAYMENT TO AMAZON/amazon@apl/UPI', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'POS FLIPKART INTERNET', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'MYNTRA DESIGNS', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'MEESHO ORDER', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'AJIO RELIANCE RETAIL', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'NYKAA ECOM', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },
  { narration: 'TATACLIQ PURCHASE', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } },

  // ─── Food Delivery (Personal · Food Delivery) ───────────────
  { narration: 'POS SWIGGY', type: 'debit', expect: { category: 'Personal', subcategory: 'Food Delivery' } },
  { narration: 'UPI/SWIGGY/swiggy@axisbank/...', type: 'debit', expect: { category: 'Personal', subcategory: 'Food Delivery' } },
  { narration: 'ZOMATO ONLINE ORDER', type: 'debit', expect: { category: 'Personal', subcategory: 'Food Delivery' } },
  { narration: 'EATFIT BLR', type: 'debit', expect: { category: 'Personal', subcategory: 'Food Delivery' } },

  // ─── Swiggy Instamart routes to Quick Commerce, not Food Delivery
  { narration: 'POS SWIGGY INSTAMART', type: 'debit', expect: { category: 'Personal', subcategory: 'Quick Commerce' } },
  { narration: 'SWIGGY STORE', type: 'debit', expect: { category: 'Personal', subcategory: 'Quick Commerce' } },

  // ─── Quick Commerce (Personal · Quick Commerce) ─────────────
  { narration: 'POS BLINKIT', type: 'debit', expect: { category: 'Personal', subcategory: 'Quick Commerce' } },
  { narration: 'ZEPTO MARKETPLACE', type: 'debit', expect: { category: 'Personal', subcategory: 'Quick Commerce' } },
  { narration: 'BIGBASKET ORDER', type: 'debit', expect: { category: 'Personal', subcategory: 'Quick Commerce' } },
  { narration: 'JIOMART BILL', type: 'debit', expect: { category: 'Personal', subcategory: 'Quick Commerce' } },

  // ─── Cabs (Personal · Cabs) ─────────────────────────────────
  { narration: 'POS OLA CABS', type: 'debit', expect: { category: 'Personal', subcategory: 'Cabs' } },
  { narration: 'UPI/OLA/ola@ybl/...', type: 'debit', expect: { category: 'Personal', subcategory: 'Cabs' } },
  { narration: 'UBER INDIA SYSTEMS', type: 'debit', expect: { category: 'Personal', subcategory: 'Cabs' } },
  { narration: 'RAPIDO BIKE TAXI', type: 'debit', expect: { category: 'Personal', subcategory: 'Cabs' } },
  { narration: 'REDBUS BOOKING', type: 'debit', expect: { category: 'Personal', subcategory: 'Cabs' } },

  // ─── Subscriptions (Personal · Subscriptions) ───────────────
  { narration: 'AMAZON PRIME', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'POS AMAZON PRIME VIDEO', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'NETFLIX.COM', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'SPOTIFY P25 RECURRING', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'HOTSTAR SUBSCRIPTION', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'YOUTUBE PREMIUM RENEWAL', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'ZEE5 PREMIUM', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },
  { narration: 'SONY LIV ANNUAL', type: 'debit', expect: { category: 'Personal', subcategory: 'Subscriptions' } },

  // ─── Fuel (Personal · Fuel) ─────────────────────────────────
  { narration: 'POS INDIAN OIL CORP', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'INDIANOIL PETROL PUMP', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'HPCL OUTLET MUMBAI', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'BPCL FUEL', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'BHARAT PETROLEUM', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'RELIANCE PETROLEUM RETAIL', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'SHELL FUEL STATION', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },
  { narration: 'NAYARA ENERGY', type: 'debit', expect: { category: 'Personal', subcategory: 'Fuel' } },

  // ─── Telecom (Personal · Telecom) ───────────────────────────
  { narration: 'AIRTEL POSTPAID BILL', type: 'debit', expect: { category: 'Personal', subcategory: 'Telecom' } },
  { narration: 'JIO RECHARGE 4G', type: 'debit', expect: { category: 'Personal', subcategory: 'Telecom' } },
  { narration: 'BSNL LANDLINE BILL', type: 'debit', expect: { category: 'Personal', subcategory: 'Telecom' } },
  // Confirm BIL/BPAY pattern still goes to Mobile Charges (not Telecom)
  { narration: 'BIL/BPAY/JIO RECHARGE', type: 'debit', expect: { category: 'Mobile Charges', subcategory: 'Jio' } },

  // ─── Restaurants (Personal · Restaurants) ───────────────────
  { narration: "POS DOMINO'S PIZZA", type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },
  { narration: 'PIZZA HUT INDIA', type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },
  { narration: "POS MCDONALD'S BLR", type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },
  { narration: 'KFC INDIA', type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },
  { narration: 'BURGER KING INDIA', type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },
  { narration: 'BARBEQUE NATION HOSPITALITY', type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },
  { narration: 'STARBUCKS COFFEE', type: 'debit', expect: { category: 'Personal', subcategory: 'Restaurants' } },

  // ─── Healthcare (Personal · Healthcare) ─────────────────────
  { narration: 'TATA 1MG', type: 'debit', expect: { category: 'Personal', subcategory: 'Healthcare' } },
  { narration: 'PHARMEASY ORDER', type: 'debit', expect: { category: 'Personal', subcategory: 'Healthcare' } },
  { narration: 'NETMEDS INDIA', type: 'debit', expect: { category: 'Personal', subcategory: 'Healthcare' } },
  { narration: 'APOLLO PHARMACY MEDS', type: 'debit', expect: { category: 'Personal', subcategory: 'Healthcare' } },
  { narration: 'PRACTO TECHNOLOGIES', type: 'debit', expect: { category: 'Personal', subcategory: 'Healthcare' } },

  // ─── Education (Personal · Education) ───────────────────────
  { narration: "BYJU'S LEARNING", type: 'debit', expect: { category: 'Personal', subcategory: 'Education' } },
  { narration: 'UNACADEMY PLUS', type: 'debit', expect: { category: 'Personal', subcategory: 'Education' } },
  { narration: 'COURSERA INC', type: 'debit', expect: { category: 'Personal', subcategory: 'Education' } },
  { narration: 'UDEMY COURSE', type: 'debit', expect: { category: 'Personal', subcategory: 'Education' } },

  // ─── Travel (Personal · Travel) ─────────────────────────────
  { narration: 'MAKEMYTRIP HOTELS', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'YATRA ONLINE TRIP', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'CLEARTRIP FLIGHT', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'GOIBIBO HOTEL', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'IRCTC ECOMM BOOKING', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'OYO ROOMS', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'BOOKING.COM RESERVATION', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },
  { narration: 'AIRBNB IRELAND', type: 'debit', expect: { category: 'Personal', subcategory: 'Travel' } },

  // ─── Entertainment (Personal · Entertainment) ───────────────
  { narration: 'BOOKMYSHOW TICKETS', type: 'debit', expect: { category: 'Personal', subcategory: 'Entertainment' } },
  { narration: 'POS PVR CINEMAS', type: 'debit', expect: { category: 'Personal', subcategory: 'Entertainment' } },
  { narration: 'INOX MOVIES', type: 'debit', expect: { category: 'Personal', subcategory: 'Entertainment' } },
  { narration: 'STEAMPOWERED.COM', type: 'debit', expect: { category: 'Personal', subcategory: 'Entertainment' } },

  // ─── Investments (Investments) — new platforms ───────────────
  { narration: 'KUVERA SIP', type: 'debit', expect: { category: 'Investments' } },
  { narration: 'PAYTM MONEY', type: 'debit', expect: { category: 'Investments' } },
  { narration: 'ANGEL ONE TRADING', type: 'debit', expect: { category: 'Investments' } },
  { narration: 'ICICIDIRECT EQUITY', type: 'debit', expect: { category: 'Investments' } },

  // ─── Insurance (Insurance) — new aggregators ─────────────────
  { narration: 'POLICYBAZAAR INSURANCE', type: 'debit', expect: { category: 'Insurance' } },
  { narration: 'ACKO INSURANCE PREMIUM', type: 'debit', expect: { category: 'Insurance' } },
  { narration: 'HDFC ERGO HEALTH', type: 'debit', expect: { category: 'Insurance' } },
  { narration: 'ICICI LOMBARD MOTOR', type: 'debit', expect: { category: 'Insurance' } },

  // ─── Negative cases — confirm word boundaries hold ──────────
  // "VISA" should NOT match the VI rule (the \bvi\b lookahead requires
  // a non-word char after VI, but VISA's S is a word char). Falls
  // through to AI.
  { narration: 'VISA INTERNATIONAL', type: 'debit', expect: null },
  // "BANGALORE" contains "ola" but no word boundary inside.
  { narration: 'NEFT-HDFC-BANGALORE BRANCH-N9876543210123', type: 'debit', expect: null },

  // ─── Genuinely ambiguous → null (AI fallback target) ────────
  { narration: 'BHAT GROCERIES', type: 'debit', expect: null },
  { narration: 'AMAZON SHOPPING', type: 'debit', expect: { category: 'Personal', subcategory: 'E-commerce' } }, // changed: now classified
  { narration: 'RAMESH SHARMA AND SONS', type: 'debit', expect: null },

  // ─── Counterparty extraction tests ────────────────────────
  {
    narration: 'UPI/509077863301/FROM: rajabilalmatta.rb@okicici/TO: sf3458311-4@okaxis/UPI',
    type: 'credit',
    expect: { category: 'Transfers' },
    expectCounterparty: 'rajabilalmatta.rb@okicici',
  },
  {
    // Realistic NEFT UTR is 16 chars (4-letter IFSC prefix + 12 digit
    // running counter). Shorter refs in narrations are typically the
    // payment-system batch counter, not UTR.
    narration: 'NEFT-HDFC-SALARY MAR-N235010050001234',
    type: 'credit',
    expect: { category: 'Salary' },
    expectCounterparty: 'SALARY MAR',
    expectReference: 'N235010050001234',
  },
];

function eq(a: unknown, b: unknown): boolean {
  return a === b;
}

function run(): void {
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  for (const c of CASES) {
    const result = classifyRow({ narration: c.narration, type: c.type, amount: c.amount });

    // Category check.
    if (c.expect === null) {
      if (result !== null) {
        fail++;
        failures.push(`expected null, got ${JSON.stringify(result)} — ${c.narration}`);
        continue;
      }
    } else {
      if (result === null) {
        fail++;
        failures.push(`expected ${c.expect.category}, got null — ${c.narration}`);
        continue;
      }
      if (!eq(result.category, c.expect.category)) {
        fail++;
        failures.push(`category mismatch: expected "${c.expect.category}", got "${result.category}" — ${c.narration}`);
        continue;
      }
      if (c.expect.subcategory !== undefined && !eq(result.subcategory, c.expect.subcategory)) {
        fail++;
        failures.push(`subcategory mismatch: expected "${c.expect.subcategory}", got "${result.subcategory}" — ${c.narration}`);
        continue;
      }
    }

    // Counterparty check (when explicitly asserted).
    if (c.expectCounterparty !== undefined) {
      const cp = extractCounterparty(c.narration);
      if (!eq(cp, c.expectCounterparty)) {
        fail++;
        failures.push(`counterparty mismatch: expected "${c.expectCounterparty}", got "${cp}" — ${c.narration}`);
        continue;
      }
    }

    // Reference check (when explicitly asserted).
    if (c.expectReference !== undefined) {
      const ref = extractReference(c.narration);
      if (!eq(ref, c.expectReference)) {
        fail++;
        failures.push(`reference mismatch: expected "${c.expectReference}", got "${ref}" — ${c.narration}`);
        continue;
      }
    }

    pass++;
  }

  // Recurring-detection smoke
  const recurringRows = [
    { narration: 'EMI 88588864 CHQ S885888640061 04248858', amount: -46973, isRecurring: false },
    { narration: 'EMI 88588864 CHQ S885888640071 05248858', amount: -46973, isRecurring: false },
    { narration: 'EMI 88420946 CHQ S884209460061 04248842', amount: -46973, isRecurring: false },
    { narration: 'UPI/Random/abc@okhdfc/once', amount: -2500, isRecurring: false },
  ];
  markRecurring(recurringRows);
  const recurringFlags = recurringRows.map(r => r.isRecurring);
  // Expect: rows 0-2 (matching EMI prefix + same ₹46,973) → all true; row 3 → false.
  if (!recurringFlags[0] || !recurringFlags[1] || !recurringFlags[2]) {
    fail++;
    failures.push(`recurring detection: expected all 3 EMI rows true, got ${JSON.stringify(recurringFlags)}`);
  } else if (recurringFlags[3]) {
    fail++;
    failures.push(`recurring detection: row 3 should be false, got true`);
  } else {
    pass++;
  }

  // ─── normalizeCounterpartyKey ───────────────────────────────
  const normCases: Array<[string | null, string]> = [
    ['BOYAAIRTEL.123-1@OKICICI', 'boyaairtel.123'],
    ['BOYAAIRTEL.123-2@OKAXIS', 'boyaairtel.123'],
    ['BOYAAIRTEL.123-3@OKSBI', 'boyaairtel.123'],
    ['rajabilalmatta.rb@okicici', 'rajabilalmatta.rb'],
    ['AMAZON', 'amazon'],
    ['SWIGGY', 'swiggy'],
    [null, ''],
    ['', ''],
  ];
  for (const [input, expected] of normCases) {
    const got = normalizeCounterpartyKey(input);
    if (got === expected) {
      pass++;
    } else {
      fail++;
      failures.push(`normalizeCounterpartyKey('${input}'): expected '${expected}', got '${got}'`);
    }
  }

  // ─── unifyAmbiguousCounterparties: BOYAAIRTEL case ──────────
  // 5 rows, same person (different VPA suffixes), all DEBIT. AI gave
  // 3 different category tags. Expected: majority (Business Expenses,
  // 3 rows) wins; the 2 minority rows back-fill to that.
  const consistencyRows = [
    { counterparty: 'BOYAAIRTEL.123-1@OKICICI', type: 'debit' as const, category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'BOYAAIRTEL.123-2@OKAXIS',  type: 'debit' as const, category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'BOYAAIRTEL.123-2@OKAXIS',  type: 'debit' as const, category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'BOYAAIRTEL.123-2@OKAXIS',  type: 'debit' as const, category: 'Personal',          subcategory: 'Shopping' },
    { counterparty: 'BOYAAIRTEL.123-3@OKSBI',   type: 'debit' as const, category: 'Transfers',         subcategory: null as string | null },
  ];
  const changed = unifyAmbiguousCounterparties(consistencyRows);
  if (changed !== 2) {
    fail++;
    failures.push(`unifyAmbiguousCounterparties BOYAAIRTEL: expected 2 changes, got ${changed}`);
  } else if (!consistencyRows.every(r => r.category === 'Business Expenses' && r.subcategory === null)) {
    fail++;
    failures.push(`unifyAmbiguousCounterparties BOYAAIRTEL: rows not unified — ${JSON.stringify(consistencyRows.map(r => `${r.category}/${r.subcategory ?? ''}`))}`);
  } else {
    pass++;
  }

  // ─── unifyAmbiguousCounterparties: direction-split safety ───
  // Same counterparty, opposite directions → should NOT merge.
  // The "vendor" pattern: 3 debits (Business Expenses) + 1 credit
  // (refund from vendor → Business Income). Direction-split should
  // preserve both categories.
  const directionRows = [
    { counterparty: 'vendor@upi', type: 'debit' as const,  category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'vendor@upi', type: 'debit' as const,  category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'vendor@upi', type: 'debit' as const,  category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'vendor@upi', type: 'credit' as const, category: 'Business Income',   subcategory: null as string | null },
  ];
  const dChanged = unifyAmbiguousCounterparties(directionRows);
  if (dChanged !== 0) {
    fail++;
    failures.push(`unifyAmbiguousCounterparties direction-split: expected 0 changes (debit group consistent, credit group too small), got ${dChanged}`);
  } else if (directionRows[3].category !== 'Business Income') {
    fail++;
    failures.push(`unifyAmbiguousCounterparties direction-split: credit row got overwritten`);
  } else {
    pass++;
  }

  // ─── unifyAmbiguousCounterparties: group too small → skip ───
  // 2 rows = below the minimum-group-size threshold (3). Should leave
  // them alone even if they disagree.
  const smallRows = [
    { counterparty: 'oneoff@upi', type: 'debit' as const, category: 'Personal',          subcategory: 'Shopping' as string | null },
    { counterparty: 'oneoff@upi', type: 'debit' as const, category: 'Business Expenses', subcategory: null as string | null },
  ];
  const sChanged = unifyAmbiguousCounterparties(smallRows);
  if (sChanged !== 0) {
    fail++;
    failures.push(`unifyAmbiguousCounterparties small-group: expected 0 changes, got ${sChanged}`);
  } else {
    pass++;
  }

  // ─── unifyAmbiguousCounterparties: tied majority → skip ─────
  // 4 rows in 2 buckets of 2 each. No clear majority → leave as-is.
  const tiedRows = [
    { counterparty: 'tie@upi', type: 'debit' as const, category: 'Personal',          subcategory: 'Shopping' as string | null },
    { counterparty: 'tie@upi', type: 'debit' as const, category: 'Personal',          subcategory: 'Shopping' as string | null },
    { counterparty: 'tie@upi', type: 'debit' as const, category: 'Business Expenses', subcategory: null as string | null },
    { counterparty: 'tie@upi', type: 'debit' as const, category: 'Business Expenses', subcategory: null as string | null },
  ];
  const tChanged = unifyAmbiguousCounterparties(tiedRows);
  if (tChanged !== 0) {
    fail++;
    failures.push(`unifyAmbiguousCounterparties tied: expected 0 changes (2-2 tie has no clear majority), got ${tChanged}`);
  } else {
    pass++;
  }

  // ─── validateDirectionCategory: catches impossible combos ──
  const directionValidationRows = [
    { type: 'debit'  as const, category: 'Business Income',     subcategory: null as string | null },  // impossible
    { type: 'credit' as const, category: 'Business Expenses',   subcategory: null as string | null },  // impossible
    { type: 'debit'  as const, category: 'Cash Deposit',         subcategory: 'Counter' as string | null },  // impossible
    { type: 'credit' as const, category: 'Loan EMI',             subcategory: null as string | null },  // impossible
    { type: 'debit'  as const, category: 'Business Expenses',   subcategory: 'Software' as string | null },  // valid
    { type: 'credit' as const, category: 'Business Income',     subcategory: null as string | null },  // valid
    { type: 'debit'  as const, category: 'Personal',            subcategory: 'E-commerce' as string | null },  // valid
  ];
  const vDemoted = validateDirectionCategory(directionValidationRows);
  if (vDemoted !== 4) {
    fail++;
    failures.push(`validateDirectionCategory: expected 4 demotions, got ${vDemoted}`);
  } else if (
    directionValidationRows[0].category !== 'Other' ||
    directionValidationRows[1].category !== 'Other' ||
    directionValidationRows[2].category !== 'Other' ||
    directionValidationRows[3].category !== 'Other' ||
    directionValidationRows[4].category !== 'Business Expenses' ||
    directionValidationRows[5].category !== 'Business Income' ||
    directionValidationRows[6].category !== 'Personal'
  ) {
    fail++;
    failures.push(`validateDirectionCategory: row categories after pass: ${JSON.stringify(directionValidationRows.map(r => r.category))}`);
  } else {
    pass++;
  }

  // ─── applyRetailBusinessPromotion: detects FOOD HUT case ────
  // Build 35 small UPI credits from 25 distinct counterparties — should fire.
  const retailRows: Array<{ type: 'credit' | 'debit'; amount: number; counterparty: string | null; category: string; subcategory: string | null }> = [];
  for (let i = 0; i < 35; i++) {
    retailRows.push({
      type: 'credit',
      amount: 100 + i * 10,
      counterparty: `customer${i % 25}@upi`,
      category: 'Personal',
      subcategory: 'Shopping',
    });
  }
  // Mix in a few non-promotable rows
  retailRows.push({ type: 'credit', amount: 50000, counterparty: 'big@upi', category: 'Personal', subcategory: 'Shopping' });  // too large
  retailRows.push({ type: 'credit', amount: 500, counterparty: 'salary@corp', category: 'Salary', subcategory: null });  // already specific
  retailRows.push({ type: 'debit', amount: 200, counterparty: 'food@upi', category: 'Personal', subcategory: 'Food Delivery' });  // debit, untouched
  const retailResult = applyRetailBusinessPromotion(retailRows);
  if (retailResult.statementType !== 'retail_business_current') {
    fail++;
    failures.push(`applyRetailBusinessPromotion: expected statementType retail_business_current, got ${retailResult.statementType}`);
  } else if (retailResult.promoted !== 35) {
    fail++;
    failures.push(`applyRetailBusinessPromotion: expected 35 promoted, got ${retailResult.promoted}`);
  } else if (retailRows[0].category !== 'Business Income' || retailRows[0].subcategory !== 'Sales') {
    fail++;
    failures.push(`applyRetailBusinessPromotion: row 0 not promoted; got ${retailRows[0].category}/${retailRows[0].subcategory}`);
  } else if (retailRows[35].category !== 'Personal') {
    // Large credit (50000) untouched
    fail++;
    failures.push(`applyRetailBusinessPromotion: row 35 (large credit) wrongly promoted`);
  } else if (retailRows[36].category !== 'Salary') {
    // Salary row stays
    fail++;
    failures.push(`applyRetailBusinessPromotion: row 36 (Salary) wrongly overridden`);
  } else if (retailRows[37].category !== 'Personal') {
    // Debit untouched
    fail++;
    failures.push(`applyRetailBusinessPromotion: row 37 (debit) wrongly overridden`);
  } else {
    pass++;
  }

  // ─── applyRetailBusinessPromotion: too few rows → no fire ───
  const personalAccountRows = [
    { type: 'credit' as const, amount: 500, counterparty: 'friend1@upi', category: 'Personal', subcategory: 'Shopping' as string | null },
    { type: 'credit' as const, amount: 1000, counterparty: 'friend2@upi', category: 'Personal', subcategory: 'Shopping' as string | null },
    { type: 'credit' as const, amount: 200, counterparty: 'friend3@upi', category: 'Personal', subcategory: 'Shopping' as string | null },
  ];
  const personalResult = applyRetailBusinessPromotion(personalAccountRows);
  if (personalResult.statementType !== null) {
    fail++;
    failures.push(`applyRetailBusinessPromotion: 3-row personal account should NOT trigger, got ${personalResult.statementType}`);
  } else if (personalAccountRows[0].category !== 'Personal') {
    fail++;
    failures.push(`applyRetailBusinessPromotion: personal-account row wrongly promoted`);
  } else {
    pass++;
  }

  // ─── classifyWithLearning — tier precedence ──────────────────
  // Locked precedence (2026-05-22): learned > anchor > unclassified.
  // These cases construct a mock learnedLookup that returns canned
  // rules and verifies each tier fires correctly.

  // Case 1: learned wins over anchor when both have an opinion.
  {
    const lookup = (_fp: string, _dir: 'credit' | 'debit'): LearnedRuleLike | null => ({
      id: 'rule-1', category: 'Business Expenses', subcategory: null,
    });
    // "ATM CHARGES QUARTERLY" matches the anchor for Bank Charges/ATM.
    // The learned rule overrides to a different category.
    const r = classifyWithLearning(
      { narration: 'ATM CHARGES QUARTERLY', type: 'debit', amount: 200 },
      lookup,
    );
    if (r.tier === 'learned' && r.result?.category === 'Business Expenses' && r.anchorConflict) {
      pass++;
    } else {
      fail++;
      failures.push(`classifyWithLearning: learned-overrides-anchor — got tier=${r.tier} cat=${r.result?.category}`);
    }
  }

  // Case 2: no learned rule, anchor fires.
  {
    const noLearn = (_fp: string, _dir: 'credit' | 'debit'): LearnedRuleLike | null => null;
    const r = classifyWithLearning(
      { narration: 'ATM CHARGES QUARTERLY', type: 'debit', amount: 200 },
      noLearn,
    );
    if (r.tier === 'anchor' && r.result?.subcategory === 'ATM' && !r.anchorConflict) {
      pass++;
    } else {
      fail++;
      failures.push(`classifyWithLearning: anchor-only — got tier=${r.tier}`);
    }
  }

  // Case 3: no learned, no anchor → unclassified (caller sends to AI).
  {
    const noLearn = (_fp: string, _dir: 'credit' | 'debit'): LearnedRuleLike | null => null;
    const r = classifyWithLearning(
      { narration: 'RANDOM NARRATION WITH NO ANCHORS', type: 'debit', amount: 1000 },
      noLearn,
    );
    if (r.tier === 'unclassified' && r.result === null) {
      pass++;
    } else {
      fail++;
      failures.push(`classifyWithLearning: unclassified — got tier=${r.tier}`);
    }
  }

  // Case 4: empty fingerprint short-circuits learned lookup.
  // Pure-noise narrations ("UPI NEFT") fingerprint to empty string —
  // the learned-rule layer must not attempt a lookup with an empty
  // key (would otherwise risk matching a stray entry).
  {
    let lookupCalled = false;
    const trackingLookup = (_fp: string, _dir: 'credit' | 'debit'): LearnedRuleLike | null => {
      lookupCalled = true;
      return null;
    };
    classifyWithLearning(
      { narration: 'UPI NEFT', type: 'debit', amount: 100 },
      trackingLookup,
    );
    if (!lookupCalled) {
      pass++;
    } else {
      fail++;
      failures.push(`classifyWithLearning: empty fingerprint should skip lookup, but lookup was called`);
    }
  }

  // Case 5: learned rule preserves counterparty/reference from anchor.
  // When the anchor returned a counterparty even though the learned
  // rule wins on category, we want to keep that counterparty so the
  // row's display data isn't blank.
  {
    const lookup = (_fp: string, _dir: 'credit' | 'debit'): LearnedRuleLike | null => ({
      id: 'rule-2', category: 'Personal', subcategory: null,
    });
    const r = classifyWithLearning(
      { narration: 'POS PURCHASE BIGBASKET BANGALORE 15/06/2025', type: 'debit', amount: 1500 },
      lookup,
    );
    if (r.tier === 'learned' && r.result?.counterparty && r.result.counterparty.toUpperCase().includes('BIGBASKET')) {
      pass++;
    } else {
      fail++;
      failures.push(`classifyWithLearning: counterparty preservation — got "${r.result?.counterparty}"`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
}

run();
