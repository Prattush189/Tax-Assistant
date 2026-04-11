# Feature Plan — ITR Filing Tab (ITR-1 & ITR-4)

**Status:** Draft plan, not yet a GSD phase. Feed into `/gsd:plan-phase` or split into phases once scope is locked.

**Date drafted:** 2026-04-11

---

## 1. Goal & non-goals

### Goal
Add a new top-level tab ("ITR Filing") where a user walks through a guided, multi-step wizard to produce a **CBDT-schema-valid `ITR-1` or `ITR-4` JSON file** and a human-readable PDF preview for AY 2025-26 (FY 2024-25). The user then:
1. Downloads the JSON.
2. Opens the government's offline **Common Utility** (already shipped in `server/data/ITDe-Filing-2025-Setup-1.2.9/`) and imports the JSON for final validation + upload to `incometax.gov.in`.

### Non-goals (critical — do not cross these lines)
- **No e-filing integration.** We do not talk to the TRACES / e-filing portal. No DSC, no Aadhaar OTP, no EVC.
- **No automated upload.** User installs and runs the Common Utility themselves.
- **No other ITR forms** in this phase. ITR-2, 3, 5, 6, 7 are out of scope.
- **No tax-optimization inside the wizard.** Regime comparison still lives in the Calculator tab — the ITR wizard only asks which regime you're filing under.
- **No "updated return" (139(8A))** in MVP — the schemas support it, but the UI surface area is large and it's a niche path. Keep the branch hidden but the schema fields reserved.

---

## 2. User flow (MVP)

The wizard is a single vertical flow with numbered steps and a progress rail on the left. Each step has its own route-like state key so we can deep-link and resume drafts.

### Step 0 — Form selection
- Card picker: **ITR-1 (Sahaj)** vs **ITR-4 (Sugam)**.
- Each card has a one-paragraph eligibility summary plus a "Not sure?" link that opens an inline eligibility checklist (we already have the ITR matrix in reference data — reuse `reference-data.txt` section 7).
- Eligibility-blocking answers (e.g. LTCG > 1.25L, foreign income, capital gains on property, > 1 house property, director of a company, unlisted shares) force the user to ITR-2/3 with an explanation and halt.
- AY selector (default: 2025-26, future-proofed for 2026-27 once schemas ship).

### Step 1 — Personal info (`PersonalInfo`)
- PAN, Aadhaar (12-digit), first/middle/last name (validated against PAN pattern `[A-Z]{5}[0-9]{4}[A-Z]`).
- DOB, gender (where required), status (Individual for ITR-1, Individual/HUF/Firm for ITR-4), residential status (`RES` / `NRI` / `RNOR`).
- Address (flat, building, road, area, city, state enum, country, PIN 6-digit).
- Mobile (+91), email, employer category (for salaried).
- **Prefill from the user's profile** if they've logged in with Google / have a tax profile saved.

### Step 2 — Filing status (`FilingStatus`)
- Return type: Original / Revised / Belated / Updated(139(8A) — disabled in MVP).
- If Revised: original ack no, original filing date.
- Section filed under: `11` (139(1)), `12` (139(4) belated), `13` (139(5) revised), `14` (92CD), `15` (119(2)(b)), `17` (142(1)) — radio with descriptions.
- Regime: **New (default)** / Old. Surfaces a warning pill linking to the Calculator tab if user hasn't run regime comparison.
- 7th proviso triggers (deposits > 1Cr, electricity > 1L, foreign travel > 2L) — three Y/N toggles.

### Step 3 — Income
**ITR-1 path** (`ITR1_IncomeDeductions`):
- **Salary** subsection — employer name, TAN, gross salary, allowances (17(1), 17(2) perqs, 17(3) profits in lieu), exempt allowances breakup (HRA, LTA, gratuity, leave encashment, etc.), standard deduction (auto-filled 50k/75k depending on regime + FY), professional tax. Support **multiple employers** (array). Reuse: the existing `HraCalculator` logic, `TaxCalculatorContext` deduction state as a starting point.
- **House Property** subsection — single SOP (self-occupied) for ITR-1 only. Fields: address, tenant name (if let-out), annual let-out rent, municipal tax, 30% standard deduction (auto), interest on borrowed capital (`ScheduleUs24B` — lender name, loan account, sanction date, interest paid, principal paid). **Cap: one SOP for ITR-1** per eligibility.
- **Other Sources** — savings bank interest (auto-populates `Schedule80TTA`), FD interest, dividends (split: ≤ 5k vs > 5k for s.194 TDS), family pension (std deduction 15k/33.33%), winnings from lottery/race/card games (taxed at flat 30% — special handling), agricultural income > 5k (disqualifies ITR-1).

**ITR-4 path** (`IncomeDeductions` + `ScheduleBP`):
- Everything above PLUS:
- **Business / Profession** subsection, gated by a sub-picker:
  - **Presumptive 44AD** (business) — gross turnover (split cash vs bank), presumptive income (auto = 6%/8% of turnover with toggle), NoB code dropdown (CBDT nature-of-business enum; needs lookup data file).
  - **Presumptive 44ADA** (profession) — gross receipts, presumptive income (auto = 50%), profession code.
  - **Presumptive 44AE** (goods carriage) — number of heavy/non-heavy vehicles owned, months owned per vehicle (array), income per vehicle per month (fixed ₹1,000 or ₹7,500). This is a mini-spreadsheet UI.
  - **Not applicable** → bounce to "use ITR-3" message.
- **Financial particulars** — sundry debtors, sundry creditors, stock-in-trade, cash balance. Short form for presumptive cases.

### Step 4 — Deductions (Chapter VI-A)
Reuse existing `ProfileSelector` + extend. Collapsed accordions by default (per user preference from session notes):
- **80C** (`Schedule80C`) — line-by-line (LIC, PPF, ELSS, tuition, principal repayment, etc.) capped at 1.5L with real-time running total bar.
- **80CCD(1)** / **80CCD(1B)** / **80CCD(2)** — NPS employee/self + additional 50k + employer contribution.
- **80D** (`Schedule80D`) — self/family + parents, senior-citizen toggles, preventive health check-up (5k sub-cap).
- **80DD** / **80U** (`Schedule80DD` / `Schedule80U`) — disability with disability-% picker, auto-computes 75k or 1.25L.
- **80E** — education loan interest, lender details.
- **80EE** / **80EEA** / **80EEB** — home loan / EV loan interest.
- **80G** (`Schedule80G`) — donation list with 100%/50% classification, donee PAN/name/address. Sub-tabs for "subject to limit" vs "without limit".
- **80GGC** (`Schedule80GGC`) — political party donations, transaction mode validation.
- **80TTA / 80TTB** — auto-filled from Step 3 savings interest, capped 10k / 50k.

Show a **"deductions locked"** overlay for users who picked the **new regime** in Step 2 — new regime only allows 80CCD(2), 80CCH, 80JJAA. The overlay explains and offers a "switch regime" shortcut back to Step 2.

### Step 5 — Taxes paid & TDS
- **TDS on salary** (`TDSonSalaries`) — array: TAN, employer name, gross salary, total TDS. Prefill from Step 3 salary if only one employer.
- **TDS other than salary** (`TDSonOthThanSals`) — array: TAN, deductor name, unique TDS certificate no, section (reuse the **62-section list from `tdsEngine.ts`** as a combobox), gross receipt, TDS deducted, TDS credit claimed.
- **TDS(3)** (`ScheduleTDS3Dtls`) — tenant/buyer TDS on property rent/sale u/s 194-IA, 194-IB, 194M, 194N, 194S (VDA).
- **TCS** (`ScheduleTCS`) — collector TAN, name, amount, section.
- **Advance tax + self-assessment tax** (`TaxPayments`) — BSR code, date, challan serial no, amount. Array.

### Step 6 — Bank account & refund (`Refund`)
- Array of bank accounts (min 1, max unlimited per schema). IFSC, account number, account type (savings/current), bank name auto-resolved from IFSC. **One must be marked `RefundInto: Y`**.

### Step 7 — Review & validate
- Two-pane layout: left is a section-by-section summary; right is a **live PDF preview** (reuse `jsPDF` infrastructure from notices with similar letterhead/watermark options but simpler).
- Top banner runs **client-side JSON Schema validation** against the loaded `ITR-1_2025_Main_V1.2.json` / `ITR-4_2025_Main_V1.3_0.json`. Each error links to the step + field that failed.
- "Download JSON" button (primary) and "Download PDF preview" button (secondary).
- After download, a modal explains the Common Utility hand-off with exact steps ("Open the utility → Import Prefilled Data → select the JSON → run validation → generate signed XML/JSON → upload to `incometax.gov.in`"). This modal links to the MSI file for the user to install locally (NOT automated — user just downloads).

### Step 8 — Save draft (persistent across sessions)
- Drafts autosave to the server (authed users) or localStorage (fallback).
- Sidebar shows the user's draft list like notices/chats (see §5.2).
- One user can have multiple drafts (one per AY + form type is natural, but allow multiple named drafts for consultants handling many clients — this dovetails with `plugin_consultant_id` introduced in session notes).

---

## 3. Data architecture

### 3.1 The two axes

There are two representations to keep in sync:

1. **UI model** — ergonomic, flat-ish, TypeScript-friendly, designed for React forms. Handles things like `string` for numeric inputs (for controlled inputs with empty-state), nested arrays with UI-only IDs, etc.
2. **CBDT JSON model** — exactly what the schemas demand. Strict types, `nonEmptyString`, enum codes, arrays, deep nesting.

The conversion layer (`itrMapper.ts`) lives server-side and is the single source of truth for schema shape. Client imports **type definitions only** (generated from JSON Schema).

### 3.2 Type generation

Use [`json-schema-to-typescript`](https://www.npmjs.com/package/json-schema-to-typescript) at build time to produce `server/lib/itr/types/Itr1.ts` and `server/lib/itr/types/Itr4.ts`. Commit the generated files. A `npm run itr:types` script regenerates them. This gives the mapper strong typing without writing ~200 interfaces by hand.

### 3.3 Server-side JSON schema validator

Use **`ajv`** (Draft-04 compatible with `ajv-draft-04` or `ajv@6`). Load the two schemas once at server boot (add to `server/lib/itr/validator.ts`), compile, cache. Expose:

```ts
validateItr1(json: unknown): { valid: true } | { valid: false; errors: AjvError[] }
validateItr4(json: unknown): { valid: true } | { valid: false; errors: AjvError[] }
```

The client should also call the same validator via `POST /api/itr/validate` before enabling the Download button. **Do not reimplement validation in the browser** — the schemas are large (10k+ lines combined) and bundling them + ajv doubles main chunk size. Server round-trip is cheap.

### 3.4 Schema quirks to budget for

- `CreationInfo.SWCreatedBy` uses pattern `[S][W][0-9]{8}` — we need an allocated SW-ID from CBDT. **Open question for user** (§10.1): does Smart AI have one? If not, MVP uses a placeholder and the PDF preview warns this JSON cannot be uploaded directly — user re-signs with the Common Utility, which overwrites this.
- `Digest` pattern `-|.{44}` — SHA-256 digest of the JSON content, generated at export time.
- `JSONCreationDate` ISO `YYYY-MM-DD` in IST.
- Many fields use `allOf: [{$ref: nonEmptyString}]` with a `pattern` — `nonEmptyString` = `"type": "string", "minLength": 1`. Ajv handles this natively.
- Enum codes are stringified numerics (e.g. `ReasonsForUpdatingIncome`: `"1"`..`"7"`, `"OTH"`). The form should show labels; the mapper stores codes.
- Section codes for TDS are coded enums (e.g. `192`, `194A`, `194C`). The `tdsEngine.ts` section IDs must align — **audit this alignment in Phase 2**.
- ITR-4's `NatureOfBusinessCode` and `NatureOfProfessionCode` pull from a CBDT enum (~350 codes). We need a lookup file — see §9.3.

---

## 4. Server architecture

### 4.1 New route file: `server/routes/itr.ts`

```
GET    /api/itr/drafts                 list user's drafts
POST   /api/itr/drafts                 create new draft {formType, ay, name}
GET    /api/itr/drafts/:id             load draft
PATCH  /api/itr/drafts/:id             partial update (used by autosave)
DELETE /api/itr/drafts/:id             delete
POST   /api/itr/validate               { formType, payload } → { valid, errors }
POST   /api/itr/export-json            { draftId } → { json, digest, filename }
POST   /api/itr/export-pdf             { draftId } → streams PDF
GET    /api/itr/enums/nature-of-business   CBDT NoB enum
GET    /api/itr/enums/states               state codes
GET    /api/itr/enums/countries            country codes
```

All routes go behind the existing `requireAuth` middleware. Plan gating: ITR filing is a **Pro feature** — free users hit the tab, see the wizard preview, but export and autosave are locked behind `ProLock` with a targeted CTA. Enterprise-shared plan (from session 2026-04-11) controls how many drafts per staff — integrate via `getUserLimits()`.

### 4.2 New directory: `server/lib/itr/`

```
server/lib/itr/
├── schemas/
│   ├── itr1.schema.json           (symlink or copy of server/data/ITR-1/ITR-1_2025_Main_V1.2.json)
│   └── itr4.schema.json           (symlink or copy of server/data/ITR-4/ITR-4_2025_Main_V1.3_0.json)
├── types/
│   ├── Itr1.ts                    (generated)
│   └── Itr4.ts                    (generated)
├── enums/
│   ├── natureOfBusiness.ts        (CBDT NoB + profession codes, hand-curated or pdf-extracted)
│   ├── states.ts
│   ├── countries.ts
│   └── sections.ts                (TDS section codes — import from tdsEngine.ts)
├── validator.ts                   (ajv compile + cache)
├── mapper.ts                      (UI model → CBDT JSON — the big one)
├── digest.ts                      (SHA-256 over canonical JSON)
├── pdfRenderer.ts                 (jsPDF server-side rendering of the preview)
└── creationInfo.ts                (SWVersionNo/SWCreatedBy/JSONCreatedBy constants)
```

### 4.3 Database — new table `itr_drafts`

Add to `server/db/schema.sql` (guarded by `IF NOT EXISTS`) AND add a migration block in `server/db/index.ts` (per the session-notes rule: **do not add new CREATE INDEX to schema.sql for columns that might be added later** — put indexes in the migration block).

```sql
CREATE TABLE IF NOT EXISTS itr_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL CHECK (form_type IN ('ITR1','ITR4')),
  assessment_year TEXT NOT NULL,          -- e.g. '2025-26'
  name TEXT NOT NULL,                     -- user label (e.g. client name for consultants)
  ui_payload TEXT NOT NULL,               -- JSON blob of the UI model
  last_validated_at TEXT,
  last_validation_errors TEXT,            -- JSON array or null if valid
  exported_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Indexes via db/index.ts migration block:
--   idx_itr_drafts_user_id
--   idx_itr_drafts_updated_at
```

New repo: `server/db/repositories/itrDraftRepo.ts` with CRUD + list-by-user.

### 4.4 PDF rendering

Server-side jsPDF is viable, but the existing notices system already runs jsPDF **client-side** for letterhead/watermark. For parity and to avoid shipping jsPDF to the server, render the PDF client-side from the UI model in `src/lib/itr/pdfRenderer.ts` and just let the browser `save-as`. The `/api/itr/export-pdf` endpoint can be deferred — remove it from §4.1 for MVP.

**MVP decision:** client-side PDF. Backend only exports/validates JSON.

---

## 5. Client architecture

### 5.1 New view type

In `src/App.tsx`, extend:
```ts
type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices' | 'settings' | 'itr';
```

Wire through `Sidebar`, `Header`, `PluginMessageDispatcher` (new `SET_VIEW: 'itr'` is automatically valid once the union is extended, but the plugin protocol types in `src/lib/pluginProtocol.ts` need the literal added).

### 5.2 Sidebar integration

In `Sidebar.tsx` `baseNavItems`, add:
```ts
{ id: 'itr', label: 'ITR', icon: FileSpreadsheet }, // between notices and dashboard
```

Follow the existing **draft list** pattern used by chat/notices:
- When `activeView === 'itr'`, the sidebar shows the user's ITR draft list.
- "New draft" button at the top (opens form picker).
- Click to load. Hover to show delete. Delete uses the same `confirmBeforeDeletingChats` preference (rename in preferences later if it matters — not blocking).
- Free users see a Lock icon on the sidebar entry (same as Salary Optimizer today).

### 5.3 Component tree

```
src/components/itr/
├── ItrView.tsx                       (top-level, handles wizard state machine)
├── ItrFormPicker.tsx                 (Step 0)
├── steps/
│   ├── PersonalInfoStep.tsx
│   ├── FilingStatusStep.tsx
│   ├── Income/
│   │   ├── IncomeStep.tsx            (router: salary + HP + OS + business)
│   │   ├── SalaryFields.tsx
│   │   ├── HousePropertyFields.tsx
│   │   ├── OtherSourcesFields.tsx
│   │   └── BusinessFields.tsx        (ITR-4 only, routes to 44AD/44ADA/44AE)
│   ├── DeductionsStep.tsx            (chapter VI-A accordion)
│   ├── TaxesPaidStep.tsx             (TDS/TCS/advance tax)
│   ├── BankRefundStep.tsx
│   └── ReviewStep.tsx                (validation + PDF + download)
├── shared/
│   ├── WizardShell.tsx               (progress rail + step frame)
│   ├── PanInput.tsx                  (validated PAN input with mask)
│   ├── AadhaarInput.tsx
│   ├── IfscInput.tsx                 (IFSC → bank name lookup)
│   ├── PinCodeInput.tsx
│   ├── RupeeInput.tsx
│   ├── PhoneInput.tsx
│   ├── AccordionSection.tsx          (collapsed-by-default per user pref)
│   └── ValidationErrorList.tsx       (maps ajv errors → step + field highlights)
├── hooks/
│   ├── useItrDraft.ts                (loads/saves draft via /api/itr/drafts, debounced autosave)
│   ├── useItrValidator.ts            (POST /api/itr/validate, debounced)
│   └── useItrStepNavigation.ts       (URL-less state machine w/ guard rails)
└── lib/
    ├── eligibility.ts                (ITR-1 vs ITR-4 vs ITR-2/3 decision tree)
    ├── uiModel.ts                    (UI model TS types)
    ├── defaults.ts                   (empty/starter UI model for each form type)
    └── pdfExport.ts                  (jsPDF client-side renderer)
```

### 5.4 UI / styling rules (from session notes)

- **Emerald theme** `#0D9668`, no blue accents.
- **Collapsed-by-default** accordions.
- **Concise copy** in all field labels and tooltips.
- **No fake certainty** — every field with a non-trivial rule has a tooltip ("Why is 50k the cap here?") linking to the RAG reference modal for the relevant section.

### 5.5 Reuse vs new

- **Reuse** `TaxCalculatorContext` only for computed standard deduction values and regime hints — **do not entangle the ITR wizard with calculator state**. The two have different lifecycles (calculator is ephemeral, ITR is persistent/named drafts).
- **Reuse** `ProfileSelector` UI patterns but with a new `ItrDraftSelector` for the sidebar.
- **Reuse** `MessageBubble`'s `SectionModal` for inline "what does this section mean" popovers.
- **Reuse** the 62-section TDS list from `tdsEngine.ts` for the TDS-other-than-salary section combobox.

---

## 6. Schema-to-form mapping strategy

This is the highest-risk part. Two options:

### Option A — Hand-written mapper (recommended)
`server/lib/itr/mapper.ts` is a big but straightforward function: `uiModel → Itr1Json | Itr4Json`. Pros: full control, explicit handling of edge cases, can emit hand-crafted validation messages. Cons: ~1.5-2k lines; maintenance burden when CBDT ships a new schema version (roughly yearly).

### Option B — Schema-driven auto-generator
Walk the JSON Schema at runtime and generate forms dynamically (`@rjsf/core` — react-jsonschema-form). Pros: zero maintenance on schema updates. Cons: produces generic UX that will not meet the "emerald theme + collapsed-by-default + chips-for-enums" bar. The CBDT schemas are not optimized for auto-rendering (every schedule is its own definition with its own quirks).

**Decision: Option A.** Start hand-written, organized by section. The autosave payload is the UI model, and the export step runs the mapper server-side at download time.

---

## 7. Validation strategy

Three layers:

1. **Field-level (client)** — regex / range / enum checks inline as the user types. PAN pattern, Aadhaar 12-digit, IFSC 11-char, PIN 6-digit, dates in YYYY-MM-DD, rupee inputs as integers.
2. **Step-level (client)** — cross-field checks before allowing "Next". E.g. "standard deduction cannot exceed salary", "80C total ≤ 1.5L", "HRA exemption can't be claimed if no rent paid".
3. **JSON Schema (server via ajv)** — final gate before export. Errors are mapped back to UI step + field. This is the authoritative check — any CBDT Common Utility error should also be catchable here.

**Edge case:** the Common Utility may have additional business rules beyond the JSON schema (`Validation Rules_AY 2025-26_V1.1.pdf` — the 24-page rules doc for each form lists cross-section rules the schema can't express, e.g. "if 80TTA claimed, savings interest must be ≥ 80TTA deduction"). MVP does NOT cover all business rules in the validator — just the JSON schema. Phase 2 parses the PDF validation rules and encodes the most common ~20 cross-field rules manually. Document this gap prominently in the Review step: "Validation passed our schema checks. Please run the offline Common Utility for final business-rule validation before uploading."

---

## 8. ITR-1 vs ITR-4 — where they diverge

| Aspect              | ITR-1                          | ITR-4                                                   |
|---------------------|--------------------------------|---------------------------------------------------------|
| Top-level key       | `ITR1_IncomeDeductions`        | `IncomeDeductions`                                      |
| TaxComp key         | `ITR1_TaxComputation`          | `TaxComputation`                                        |
| House property      | Single SOP only                | Single SOP only (same restriction)                      |
| Business income     | Not allowed                    | `ScheduleBP` with 44AD/44ADA/44AE presumptive only      |
| Financial partic.   | None                           | Short form (debtors/creditors/stock/cash)               |
| Eligibility floor   | Income ≤ 50L, no capital gains except LTCG ≤ 1.25L under 112A | Same 50L floor, presumptive schemes only                |
| Deductions          | Same VI-A set                  | Same + 80GGA not available                              |
| Assessee type       | Individual only                | Individual + HUF + Firm (non-LLP)                       |
| Verification        | Same                           | Same                                                    |

Two separate step components only where they diverge (`BusinessFields.tsx` for ITR-4; HP/Salary/OS/Deductions are shared). Eligibility logic in `itr/lib/eligibility.ts` is the forked point.

---

## 9. Lookup data needed

### 9.1 State codes
~37 Indian states/UTs, each with a 2-char code (`"01"`, `"02"`, …, `"99"` for outside India). Extractable from `ITR1_AY_25-26_V1.7.xlsm` — the VBA-backed Excel has them in a hidden sheet.

### 9.2 Country codes
ISO-3166 numeric or CBDT's own — schema will tell us. Hardcode to JSON file.

### 9.3 Nature of Business / Profession codes (ITR-4 only)
~350 codes in a hierarchical list (e.g. `01001 — Wholesale: food items`). Source: CBDT's `NatureOfBusiness.pdf`, or extract from `ITR4_AY_25-26_V1.6.xlsm` VBA sheet. **Effort: moderate.** Commit as `server/lib/itr/enums/natureOfBusiness.ts`.

### 9.4 Bank IFSC → bank name resolver
Use `razorpay/ifsc` API (`ifsc.razorpay.com/:IFSC` — free, no auth). Client-side fetch with cache. No API key.

### 9.5 Section reference from Excel templates
The two XLSM files in `ITR1_AY_25-26_V1.7/` and `ITR4_AY_25-26_V1.6/` contain the blank ITR forms with all labels, cell ranges, and drop-down enums. **We should extract these as the canonical label source** instead of inventing our own labels. A one-off script:
- Unzip the XLSM.
- Parse `xl/sharedStrings.xml` and `xl/worksheets/sheetN.xml` for each sheet.
- Output a JSON map of cell-ref → label.
- Use this as the label dictionary for the wizard.

Script: `server/scripts/extract-itr-labels.ts`. Output: `server/lib/itr/labels/itr1-labels.json`, `itr4-labels.json`. Committed. Re-run when CBDT ships new version.

---

## 10. Design decisions (closed 2026-04-11)

1. **SWCreatedBy ID.** No CBDT-allocated ID. Use placeholder `SW00000000`. The Common Utility overwrites this on re-export (our documented hand-off flow), so impact is zero for end users. No DSP registration pursued. Note: direct e-filing API upload is explicitly out of scope, so an SW-ID is never needed for MVP.
2. **Consultant scope.** Drafts are scoped strictly by `user_id`. `plugin_consultant_id` is unused for ITR in v1. Firm-wide draft sharing is deferred to a future phase (if ever).
3. **Visibility.** **Admin only** (`user.role === 'admin'`). No ProLock, no plan limits, no Pro gating. Sidebar entry rendered conditionally next to the existing `adminNavItem`. This simplifies Phase A — no `getUserLimits()` integration needed.
4. **Updated return (139(8A)).** Disabled in MVP. Schema fields are reserved in the UI model but the form picker hides the path.
5. **Belated return + 234F late fee.** Warn on the Review step with an amber banner when filing date > due date. Banner has an "auto-fill ₹1,000 / ₹5,000" button that writes the fee into the appropriate CBDT schema field based on income ≤/> 5L.
6. **Multi-employer salary.** Unlimited array in ITR-1 salary step. No UI cap.
7. **LTCG 112A in ITR-1.** Allowed up to ₹1.25L (CBDT eligibility limit for AY 2025-26). > ₹1.25L hard-blocks with a "switch to ITR-2" message. The `LTCG112A` schema section is populated when the user enters a value.
8. **PDF preview.** Clean Smart AI report only (client-side jsPDF, fast to build). No replica of the official CBDT form layout.

---

## 11. Phasing

Estimated, rough. Each phase is a GSD `/gsd:plan-phase`-able unit.

### Phase A — Foundation (server + types)
- Copy schemas into `server/lib/itr/schemas/`.
- Set up `json-schema-to-typescript` build script.
- Generate `Itr1.ts` / `Itr4.ts`.
- Add `itr_drafts` table + migration + repo.
- Build `server/routes/itr.ts` with drafts CRUD (no validate/export yet).
- Add `ajv` + `validator.ts`, wire `POST /api/itr/validate` for ITR-1 only.
- Run one validate call against a hand-crafted known-good JSON to prove the loop works.

**Exit criteria:** can create/list/update/delete drafts via curl; can validate a manually-crafted ITR-1 JSON server-side.

### Phase B — UI scaffold + ITR-1 wizard
- New `itr` view in App.tsx, Sidebar entry, plan-lock wrapper.
- `WizardShell` + step machine.
- ITR-1 steps 0-7 (Form picker, Personal, Filing, Income, Deductions, Taxes, Bank, Review).
- Label extraction script for ITR-1 XLSM.
- Draft autosave + load via `useItrDraft`.
- Server-side validate on step change + Review.
- JSON export (download-as).
- PDF preview (clean Smart AI report, jsPDF client-side).

**Exit criteria:** a developer can fill an ITR-1 end-to-end, validate, and download a JSON the gov Common Utility accepts without modification (for a simple salaried case).

### Phase C — ITR-4 wizard
- ITR-4 schema validation loop.
- `BusinessFields.tsx` with 44AD/44ADA/44AE sub-forms.
- Nature-of-business enum import.
- Financial particulars mini-form.
- Label extraction for ITR-4 XLSM.

**Exit criteria:** same as B but for a presumptive-business case.

### Phase D — Polish + business-rule validation
- Parse `CBDT_e-Filing_ITR 1_Validation Rules_AY 2025-26_V1.1.pdf` (and the ITR-4 equivalent), encode the top ~20 cross-field business rules in a rules module.
- Per-field tooltips linking to Act sections via RAG.
- Review-step inline validation with step-jump navigation.
- Free-plan read-only wizard preview + paywall overlay.
- Common Utility hand-off modal with step-by-step walkthrough.

### Phase E (stretch)
- Replica CBDT PDF layout.
- AY 2026-27 schema once CBDT ships.
- Updated return (139(8A)) path.
- Prefill from Form 26AS / AIS upload (reuses Gemini PDF pipeline).
- Consultant bulk-filing UI (list of clients, mass-validation dashboard).

---

## 12. Files that will be created / modified

### Created
- `server/lib/itr/schemas/itr1.schema.json`
- `server/lib/itr/schemas/itr4.schema.json`
- `server/lib/itr/types/Itr1.ts` (generated)
- `server/lib/itr/types/Itr4.ts` (generated)
- `server/lib/itr/validator.ts`
- `server/lib/itr/mapper.ts`
- `server/lib/itr/digest.ts`
- `server/lib/itr/creationInfo.ts`
- `server/lib/itr/enums/natureOfBusiness.ts`
- `server/lib/itr/enums/states.ts`
- `server/lib/itr/enums/countries.ts`
- `server/lib/itr/enums/sections.ts`
- `server/lib/itr/labels/itr1-labels.json`
- `server/lib/itr/labels/itr4-labels.json`
- `server/routes/itr.ts`
- `server/db/repositories/itrDraftRepo.ts`
- `server/scripts/extract-itr-labels.ts`
- `src/components/itr/` — entire tree per §5.3
- `src/lib/itr/pdfExport.ts`

### Modified
- `src/App.tsx` — `ActiveView` union, route `itr` to `<ItrView />`
- `src/components/layout/Sidebar.tsx` — new `itr` nav entry + draft list rendering
- `src/components/layout/Header.tsx` — if plugin mode needs a titled header for ITR view
- `src/lib/pluginProtocol.ts` — `SET_VIEW` view union extended
- `server/db/schema.sql` — add `itr_drafts` CREATE TABLE only (no indexes)
- `server/db/index.ts` — add migration block for `itr_drafts` indexes
- `server/index.ts` — register `itrRoutes`
- `package.json` — add `ajv`, `ajv-draft-04`, `json-schema-to-typescript`, script `itr:types`

### Not touched (out of scope)
- `server/lib/grok.ts` / RAG — no AI in the wizard itself (the chat tab remains the Q&A entry point)
- `server/routes/chat.ts`
- `tdsEngine.ts` — we import from it, do not modify
- Notices, Calculator, Dashboard, Admin

---

## 13. Risks & mitigations

| Risk                                                          | Mitigation                                                                          |
|---------------------------------------------------------------|-------------------------------------------------------------------------------------|
| CBDT schema updates mid-development                           | Schemas versioned in repo; mapper key'd on AY; re-gen types on update               |
| Common Utility rejects valid-by-schema JSON                   | Phase D adds business-rule validator; Review step warns user to run utility         |
| Bundle size bloat from schema types in client                 | Generated types are `.ts` with no runtime — tree-shakeable; keep ajv server-only    |
| Legal — user misfiles based on our output                     | Prominent disclaimer in Review step; we produce a draft, user validates + submits   |
| `SWCreatedBy` not allocated                                   | Placeholder path with warning; do not block the feature                             |
| Autosave thrashing (drafts are large)                         | Debounce 2s; only PATCH changed section; gzip payload                               |
| PDF rendering slow for large drafts                           | Client-side jsPDF with lazy import; only render on Review step                      |
| Schema PDF validation rules are in a PDF, not a spec          | Phase D parses manually; accept gap in MVP and document it                          |

---

## 14. How this fits existing architecture (quick reference for future Claude sessions)

- **Auth + plans:** route plan-gated via `getUserLimits()` introduced in 2026-04-11 session. Pro-only for export + autosave. Free users see the wizard, can click through, but cannot save or download.
- **Plugin mode v2:** SSO handshake (`plugin_consultant_id`, `plugin_limits`) means a consultant parent app can hand off to the iframe and immediately pre-scope the draft list to one client. No additional work needed in Phase A; just scope by `user_id` and use `consultant_id` in list filters in Phase D.
- **RAG tooltips:** every section in the wizard links to the relevant Act section via the existing `SectionModal` component (`extractSectionNumbers` + `chunkHasActSectionContent` path). Zero new RAG work needed.
- **TDS section list:** `src/lib/tdsEngine.ts` `SECTIONS` is the single source of truth — import as the `<Combobox>` option list in Step 5. The 62 sections cover every section ITR-1/4 needs.
- **Styling:** emerald theme `#0D9668`, collapsed-by-default accordions, terse copy, no fake certainty. No blue accents anywhere.
- **DB migrations rule** (from 2026-04-11 session, load-bearing): new columns & indexes go in `server/db/index.ts` migration block. `schema.sql` only has `IF NOT EXISTS` base tables. The `itr_drafts` CREATE TABLE can go in `schema.sql`; its indexes must go in `db/index.ts`.

---

## 15. Decision checkpoint

Before touching any code, confirm answers to §10 (open questions). After that, the natural first move is **Phase A** (foundation) — it's small, server-only, and unblocks everything else without touching UI. Spin it up via:

```
/gsd:plan-phase
```

…and paste §11 Phase A into the phase goal.
