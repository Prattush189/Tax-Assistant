# Session Context — resume point for a fresh Claude Code session

> Paste this whole file into a new conversation or just reference the path.
> This supersedes and extends `SESSION-2026-04-11.md` (which covers earlier
> work in this same day) — read that one first for the v1.1/v1.2 baseline,
> then this for everything that followed.

**Last updated:** 2026-04-11 (late session, after ITR access capability)

---

## 0. TL;DR for a fresh Claude session

The app is **Smart AI** at `D:\tax-assistant` — React 19 + TypeScript + Vite + Express + better-sqlite3, deployed at `ai.smartbizin.com` (production path on server: `/www/wwwroot/ai.smartbizin.com`, Node 20.20, PM2-managed).

Since `SESSION-2026-04-11.md` was written, the following shipped in this repo
(local tree, not all pushed/deployed yet — see §7 deployment checklist):

1. **ITR Filing feature** — admin-only wizard for generating CBDT-compliant
   ITR-1 / ITR-4 JSON files, with schema validation via ajv. See
   `ITR-FILING-FEATURE-PLAN.md` in this same folder. ~20 new files in
   `server/lib/itr/` and `src/components/itr/`.
2. **Generic profiles** (separate from the existing tax_profiles table) —
   new `profiles` DB table with identity + address + banks + per-AY slices,
   sidebar tab, settings sub-tabs, and one-way prefill adapters into ITR
   wizard, Notice drafter, and the Income Tax calculator.
3. **Calculator tab state persistence fix** — all 6 non-income calculator
   tabs (TDS, CG, GST, AdvanceTax, SalaryOpt, InvestmentPlanner) now lift
   their state into `TaxCalculatorContext` so switching tabs no longer wipes
   values. Was breaking profile save from non-Income tabs.
4. **Email verification via SMTP2GO REST API** — 6-digit OTP on signup, 10-min
   TTL, 5-attempt cap, 60-second resend cooldown. Uses
   `https://api.smtp2go.com/v3/email/send` (not SMTP). Load-safe mailer —
   server boots cleanly without keys and returns 503 on signup.
5. **Team invitations (shared-pool enterprise plan)** — inviter can invite up
   to 9 team members (10 seats total). All members share the inviter's plan
   limits via a new `billing_user_id` column on 6 usage tables. Chain-invite
   protection, plan-downgrade auto-detach, 7-day invite token TTL,
   sha256-hashed tokens, public accept endpoint.
6. **Phone-number login** — plugin clients with only a phone number can log
   into the standalone app with `{identifier, password}`. Uses a synthetic
   `<digits>@phone.local` email placeholder to avoid a destructive SQLite
   nullable-email migration.
7. **Plugin SSO v11 HMAC** — base string extended from 9 to 11 fields
   (`userId:email:name:timestamp:nonce:plan:limits:role:consultantId:inviterUserId:phone`).
   Backward-compatible: falls back to 9-field verification ONLY when the new
   fields are absent in the body (prevents downgrade attack).
8. **Forgot password flow** — new `/forgot-password` + `/reset-password`
   endpoints. Uses the same `email_verification_codes` table with
   `purpose='reset'`. The CHECK constraint was dropped via migration to allow
   widening the enum. UI lives at `src/components/auth/ForgotPasswordPage.tsx`,
   linked from `LoginPage` "Forgot password?".
9. **ITR access as a separate capability** — NEW `users.itr_enabled` column
   lets you grant the ITR tab to specific users WITHOUT promoting them to
   full admin. New `itrAccessMiddleware` on the server, `canAccessItr` gate
   on the client (Sidebar + Header + App.tsx), and a CLI script:
   ```bash
   npx tsx server/scripts/grant-itr.ts <email> [grant|revoke]
   npx tsx server/scripts/grant-itr.ts --list
   ```

---

## 1. What the user wants next

### 1.1 New feature: Company board resolution wizard

A NEW top-level feature (not yet planned): a wizard that generates legally
formatted company board resolutions. The user wants this to live alongside
ITR Filing and Notices as a top-level tab.

**Nothing built yet.** This needs a fresh plan via `/gsd:plan-phase` or
similar. Likely shape based on the existing ITR wizard pattern:

- New sidebar tab, probably admin+itr_enabled gated (or a new
  `resolution_enabled` capability — match the ITR pattern).
- Multi-step wizard like the ITR one, with predefined resolution templates
  (appointment of director, bank account opening, borrowing powers, share
  allotment, digital signature procurement, etc.).
- Output: a DOCX or PDF. The project already has `jspdf` for client-side
  PDFs — reuse that pattern.
- Data source: probably a structured template library with fillable fields
  (company name, meeting date, director names, resolution text, etc.).
- Persistence: new DB table `board_resolutions` similar to `itr_drafts`.

**Open questions** to resolve when planning:
- Which templates are in scope for v1? (Appointment, banking, borrowing, share
  issue? User should provide the list or a priority order.)
- Output format — DOCX or PDF? Both? (DOCX would need a new dep like `docx`.)
- Does this need board member signature flows? (Probably no in v1.)
- Gating — admin only, or a new `resolutions_enabled` capability like ITR?

### 1.2 New feature: 26AS master data import

Automation to pull an assessee's master data from Form 26AS (the income tax
portal's consolidated TDS/TCS/advance-tax statement) and use it to:

1. **If no profile exists with that PAN** — create a new generic profile with
   identity + address + banks + any per-AY income data from the 26AS.
2. **If a profile exists with that PAN** — update the master details (name,
   address, phone, email) and merge new per-AY TDS/tax payment entries.
3. **When triggered from the ITR tab** — after the profile is created/updated,
   automatically run the existing "Load identity + address" action in the
   current ITR draft so the wizard instantly reflects the imported data.

**Nothing built yet.** This is the bigger of the two feature requests and
needs careful planning because 26AS is a PDF (not an API) and the portal
requires login — typical flow:

- User downloads their 26AS PDF manually from `incometax.gov.in`
- Uploads it via a new "Import 26AS" button in the Profile tab OR ITR wizard
- Server parses it (existing `pdf-lib` or a new extractor — Gemini with PDF
  input is already wired for Form 16 in `server/routes/upload.ts`, same
  pattern works)
- Extracts: PAN, name, address, DOB, bank account TDS entries, section
  194-x TDS entries, advance tax + self-assessment tax payments
- Diff against existing profile row — upsert via `profileRepoV2`
- On ITR-tab invocation: after upsert, call the existing
  `profileToItrPersonal` adapter and patch the current draft

**Files to read first when planning:**
- `src/components/profile/lib/profileModel.ts` — target schema for the import
- `src/components/profile/lib/prefillAdapters.ts` — `profileToItrPersonal` is
  already the "load identity" action — just reuse it
- `server/routes/upload.ts` — existing Gemini PDF → JSON extraction pipeline
  for Form 16. The 26AS extractor should live alongside as
  `server/routes/upload26as.ts` or extend the existing `/upload` with a
  `kind: '26as'` field
- `src/hooks/useProfileManager.ts` — the autosave + slice-update hook that
  the import would dispatch patches through

**Open questions:**
- Is 26AS ever OCR'd from an image, or always a PDF with selectable text? (PDF with text — Gemini can read it directly.)
- Which AY's 26AS do we support? Multiple years in one file, or one file per
  year? (One PDF per AY typically — `AY 2025-26` etc.)
- Should the import run entirely client-side (smaller attack surface) or
  server-side (reuse Gemini)? Recommend **server-side** — matches Form 16.
- How to handle multiple profiles per user with the same PAN from different
  data sources? The PAN field is the de-facto unique key within a user's
  profile list; add a uniqueness check.

---

## 2. Known bugs (flagged by user, unfixed)

### 2.1 ITR wizard — tax / deductions are not being calculated

**Symptom:** when the user fills in salary + deductions in the ITR wizard,
the final tax computation block is not updated. The CBDT JSON exports with
`TotalTaxPayable = 0` even though income is well above the basic exemption,
and the Chapter VI-A section totals don't add up to the value displayed on
the deductions step.

**Where to look:**
- `src/components/itr/lib/toCbdtJson.ts` — the `computeDerivedTotals()` function
  is responsible for running the tax calc before the envelope is serialized.
  Currently it computes `GrossSalary` → `NetSalary` → `IncomeFromSal` → HP +
  `IncomeOthSrc` → `GrossTotIncome` → `TotalIncome` (after chap VI-A). It
  does NOT touch `ITR1_TaxComputation` at all — all tax fields stay at their
  initial zeros from `emptyDraft()`.
- `src/components/itr/lib/uiModel.ts` — `UiTaxComputation` fields are wired
  in the `emptyDraft()` factory with zeros, but no reducer updates them.
- `src/lib/taxEngine.ts` — the standalone calculator has `calculateIncomeTax()`
  which is fully working. It accepts `{grossSalary, otherIncome, fy, regime,
  ageCategory, deductions, hra}` and returns a full result. The ITR wizard
  should import this function and use it to populate `ITR1_TaxComputation`
  before the CBDT envelope is built.

**Likely fix:** in `toCbdtJson.ts`, after `computeDerivedTotals` has
calculated `TotalIncome`, call `calculateIncomeTax()` with a regime derived
from `FilingStatus.OptOutNewTaxRegime` (`N` → new, `Y` → old) and write the
result into `ITR1_TaxComputation`:

```ts
import { calculateIncomeTax } from '../../../lib/taxEngine';
import { getTaxRules } from '../../../data/taxRules';

// Inside computeDerivedTotals, after TotalIncome is set:
const regime = draft.FilingStatus?.OptOutNewTaxRegime === 'N' ? 'new' : 'old';
const rules = getTaxRules('2025-26');
const taxRes = calculateIncomeTax({
  grossSalary: gross,
  otherIncome: othSrc,
  fy: '2025-26',
  regime,
  ageCategory: /* derive from DOB */,
  deductions: { /* map from UsrDeductUndChapVIA */ },
  hra: /* not captured in wizard currently */,
}, rules);

inc.TotalIncome = taxRes.taxableIncome;
const taxComp = {
  TotalTaxPayable: taxRes.baseTax,
  Rebate87A: taxRes.rebate87A,
  TaxPayableOnRebate: taxRes.baseTax - taxRes.rebate87A,
  EducationCess: taxRes.cess,
  GrossTaxLiability: taxRes.totalTax,
  Section89: 0,
  NetTaxLiability: taxRes.totalTax,
  TotalIntrstPay: 0,
  IntrstPay: existing_intrst_pay,
  TotTaxPlusIntrstPay: taxRes.totalTax,
};
```

But **note:** the current `taxEngine.ts` does NOT compute marginal surcharge —
see 2.2 below. So fixing the ITR wizard tax calc also requires fixing the
underlying engine, unless you scope the ITR fix to "basic tax + cess only,
surcharge TBD".

Also check the Deductions step — the Chapter VI-A total badge is computed
locally via a `useMemo` and looks correct on screen, but the TotalChapVIADeductions
persisted into the draft is computed SEPARATELY in `toCbdtJson.ts`. The two
paths can diverge if the user fills and then refreshes before the autosave
completes. Unify via a single `sumChapVIA` helper.

### 2.2 Income tax calculator missing features

Reported issues with the standalone calculator in the Calculator view (Income
Tax tab):

1. **Tax total display** — the current result cards show slab-by-slab
   breakdown but the user can't see a single "₹ Total tax" line item prominent
   at the top. Check `src/components/calculator/IncomeTaxTab.tsx` and
   `RegimeComparison.tsx` — add a summary row showing `totalTax`.
2. **Rate display** — missing. The user wants to see "effective tax rate" or
   "marginal tax rate" alongside the total. `totalTax / grossSalary` is the
   effective rate. Marginal rate comes from the slab they fall into.
3. **Marginal surcharge missing entirely** — the tax engine at
   `src/lib/taxEngine.ts` does NOT compute surcharge for incomes above ₹50L.
   This is a significant gap.

**Surcharge rules (AY 2025-26, new regime):**

| Total income | Surcharge on tax |
|---|---|
| ≤ ₹50L | 0% |
| > ₹50L, ≤ ₹1Cr | 10% |
| > ₹1Cr, ≤ ₹2Cr | 15% |
| > ₹2Cr, ≤ ₹5Cr | 25% |
| > ₹5Cr | 25% (was 37% until FY 23-24 — new regime capped at 25%) |

**Old regime:** same thresholds but > ₹5Cr goes to **37%**.

**Marginal relief:** when income just barely crosses a slab boundary (e.g.
₹50,00,001), the surcharge-inclusive tax cannot exceed the extra income
above the threshold. Formula:
```
if (income > threshold && taxWithSurcharge - taxAtThreshold > income - threshold):
  reduce surcharge so taxWithSurcharge = taxAtThreshold + (income - threshold)
```
This is what the user means by "marginal surcharge is missing".

**Where to implement:** `src/lib/taxEngine.ts` in the `calculateIncomeTax`
function. Add a `surcharge` field to `IncomeTaxResult`, compute via a new
`computeSurcharge(taxableIncome, baseTax, regime)` helper, apply marginal
relief, and include it in `totalTax`. Then update `RegimeComparison.tsx` and
`IncomeTaxTab.tsx` to display it.

Also update `src/data/taxRules.ts` with the surcharge bracket table so it's
configurable per FY (rates can change).

---

## 3. Current architecture — the stuff a new Claude needs to know fast

### 3.1 Running the app

```bash
npm run dev    # Vite on :3000 + Express (tsx watch) on :4001
npm run build  # vite build → dist/ (~13s, ~2.2MB bundle)
npm run lint   # tsc --noEmit (2 pre-existing auth.ts errors + 3 others, DO NOT TOUCH)
```

Dev server port note: Express pins to `:4001` explicitly in dev to avoid
colliding with Vite on `:3000`. See `server/index.ts` top comment.

### 3.2 DB + migrations

`data/tax-assistant.db` (SQLite, WAL). The rule: `schema.sql` is the source
of truth for new tables (`CREATE IF NOT EXISTS`), `db/index.ts` owns ALL
`ALTER TABLE`, index creation, and data migrations. Any new column goes
through the idempotent `colNames.includes(...)` pattern in `db/index.ts`.

**Users table columns added recently:**
- `role`, `plan` (original)
- `google_id`, `external_id` (SSO)
- `plugin_plan`, `plugin_limits`, `plugin_role`, `plugin_consultant_id` (plugin SSO v2)
- `phone`, `email_verified`, `inviter_id` (email OTP + team invites)
- `itr_enabled` (NEW: separate ITR capability)

**Billing-pool columns on usage tables** — `billing_user_id` on `api_usage`,
`feature_usage`, `notices`, `tax_profiles`, `profiles`, `itr_drafts`. Limit
checks + usage writes route through `getBillingUserId()` in
`server/lib/billing.ts` so an invited user's usage counts against the
inviter's pool.

**New tables:** `email_verification_codes`, `invitations`, `profiles`
(generic, parallel to tax_profiles), `itr_drafts`.

### 3.3 Key directories

```
server/
├── db/
│   ├── schema.sql            — CREATE TABLE IF NOT EXISTS only
│   ├── index.ts              — migrations + index creation + one-off backfills
│   └── repositories/
│       ├── userRepo.ts       — findByEmail/Phone/Identifier, setInviterId, setItrEnabled, ...
│       ├── invitationRepo.ts
│       ├── verificationRepo.ts — email OTP storage
│       ├── profileRepoV2.ts  — new generic profiles (slice updates)
│       ├── profileRepo.ts    — legacy tax_profiles (calculator snapshots)
│       └── itrDraftRepo.ts
├── lib/
│   ├── grok.ts               — Grok via OpenAI SDK, load-safe
│   ├── mailer.ts             — SMTP2GO v3 REST API, load-safe
│   ├── billing.ts            — getBillingUserId, countSeats, canInvite, SEAT_CAP=10
│   ├── planLimits.ts         — PLAN_DEFAULTS + getUserLimits + sanitizePluginLimits
│   └── itr/
│       ├── schemas/          — itr1.schema.json, itr4.schema.json (CBDT)
│       ├── types/            — Itr1.ts, Itr4.ts (generated via npm run itr:types)
│       ├── enums/            — states, countries, nature-of-business, sections
│       ├── validator.ts      — ajv Draft-04, loads both schemas at boot
│       ├── businessRules.ts  — cross-field business rules (80C cap, etc.)
│       ├── creationInfo.ts   — CBDT SW ID placeholder + IST date
│       └── digest.ts         — canonical-JSON SHA-256 stamping
├── middleware/auth.ts        — authMiddleware, adminMiddleware, NEW itrAccessMiddleware
├── routes/
│   ├── auth.ts               — login, signup, verify-email, resend, forgot/reset, google, plugin-sso, me, patch name/email/pwd, delete, toUserResponse helper
│   ├── invitations.ts        — public /accept + authed GET/POST/DELETE
│   ├── admin.ts              — existing plan change, new detachAllInvitees hook on enterprise downgrade
│   ├── chat.ts, upload.ts, notices.ts, suggestions.ts, profiles.ts, usage.ts
│   │   — all limit checks now route through billing_user_id via lib/billing.ts
│   ├── itr.ts                — uses itrAccessMiddleware (not adminMiddleware)
│   ├── genericProfiles.ts
│   └── ...
└── scripts/
    ├── generate-itr-types.ts — json-schema-to-typescript codegen
    ├── extract-itr-enums.ts  — pulls enums from CBDT schemas
    ├── test-itr-validator.ts — smoke test for ajv + business rules
    └── grant-itr.ts          — NEW: grant/revoke/list ITR access via CLI

src/
├── App.tsx                   — ActiveView union includes chat, calculator, notices, profile, itr, dashboard, admin, plan, settings. canAccessItr gate.
├── contexts/
│   ├── AuthContext.tsx       — login/signup/google/sso/completeEmailVerification + User interface now has itr_enabled
│   └── TaxCalculatorContext.tsx — all 7 tab state slices live here
├── hooks/
│   ├── useItrManager.ts      — ITR draft list + debounced autosave
│   ├── useProfileManager.ts  — generic profile list + per-AY patches
│   ├── useNoticeDrafter.ts
│   └── useChatManager.ts
├── services/api.ts           — ALL client fetches, one authFetch helper with 401 auto-refresh
└── components/
    ├── auth/
    │   ├── LoginPage.tsx     — identifier field (email or phone), Forgot password link
    │   ├── SignupPage.tsx    — routes to VerifyEmailPage on success
    │   ├── VerifyEmailPage.tsx — 6-digit OTP + 60s resend cooldown
    │   ├── ForgotPasswordPage.tsx — 2-step: request code → verify + new password
    │   ├── AcceptInvitePage.tsx   — public page for ?invite=<token>
    │   ├── AuthGuard.tsx     — routes between login/signup/verify/forgot views
    │   ├── GoogleSignInButton.tsx — KNOWN pre-existing crash if VITE_GOOGLE_CLIENT_ID empty
    │   └── PluginAuthBridge.tsx
    ├── layout/
    │   ├── Sidebar.tsx       — nav entries gated per role + itr_enabled, profile draft list, ITR draft list, notice list
    │   └── Header.tsx        — top nav, same gating
    ├── calculator/
    │   ├── IncomeTaxTab.tsx  — with Load-from-profile + AY picker; BUG: missing surcharge (see §2.2)
    │   ├── TdsTab.tsx, CapitalGainsTab.tsx, GstTab.tsx, AdvanceTaxTab.tsx, SalaryOptimizerTab.tsx, InvestmentPlannerTab.tsx
    │   │   — all lifted to TaxCalculatorContext
    │   ├── CalculatorView.tsx, ProfileSelector.tsx
    │   └── RegimeComparison.tsx — tax breakdown display
    ├── itr/
    │   ├── ItrView.tsx       — wizard shell + progress rail
    │   ├── steps/*.tsx       — FormPicker, PersonalInfo, FilingStatus, Income, BusinessIncome, Deductions, TaxesPaid, BankRefund, Review
    │   ├── shared/Inputs.tsx — Field, Card, Grid2/3, PanInput, AadhaarInput, IfscInput, RupeeInput, Accordion, etc. (reused by profile tabs)
    │   └── lib/
    │       ├── uiModel.ts    — ItrWizardDraft type, emptyDraft, STEP_LABELS
    │       ├── toCbdtJson.ts — UI draft → CBDT envelope; BUG: no tax calc (see §2.1)
    │       └── pdfExport.ts  — jsPDF preview (client-side)
    ├── profile/
    │   ├── ProfileView.tsx   — inner sidebar with 7 sub-tabs + AY picker
    │   ├── ProfilePicker.tsx — empty state / new profile creation
    │   ├── tabs/             — Identity, Address, Banks, SalaryIncome, Deductions, NoticeDefaults, Business
    │   ├── shared/LoadFromProfile.tsx — dropdown button used by ITR wizard steps + Notices + Calculator
    │   └── lib/
    │       ├── profileModel.ts    — typed slices + PROFILE_AYS
    │       └── prefillAdapters.ts — profileToItrPersonal, profileToItrBanks, profileToItrIncome, profileToItrDeductions, profileToItrBusiness, profileToNoticeForm, profileToCalculator
    ├── notices/NoticeForm.tsx     — has Load-from-profile button above sender section
    └── settings/
        ├── SettingsPage.tsx
        └── TeamSection.tsx   — enterprise-plan-gated invite form + member list + revoke
```

### 3.4 ITR access model (NEW — remember this)

Two independent capabilities control access to the ITR tab:

- `role = 'admin'` — grants admin panel, ITR tab, and everything else admin
- `itr_enabled = 1` — grants ITR tab only, NO admin panel

Client gate in 4 places: `App.tsx` (2), `Sidebar.tsx`, `Header.tsx`. All use:
```ts
const canAccessItr = user?.role === 'admin' || user?.itr_enabled === true;
```

Server gate: `itrAccessMiddleware` in `server/middleware/auth.ts`, applied
via `router.use(itrAccessMiddleware)` at the top of `server/routes/itr.ts`.

Grant/revoke via CLI:
```bash
npx tsx server/scripts/grant-itr.ts someone@example.com        # grant
npx tsx server/scripts/grant-itr.ts someone@example.com revoke
npx tsx server/scripts/grant-itr.ts --list
```

**Run from the project root** — the path is `server/scripts/grant-itr.ts`,
not `./grant-itr.ts`. The error the user hit on production was because they
ran it from the wrong cwd.

---

## 4. Production env vars (required for recent features)

Add these to the server's `.env`:

```bash
# Email OTP + invitations + forgot password
SMTP2GO_API_KEY=api-...your-key...
SMTP2GO_FROM=no-reply@assist.smartbizin.com
APP_URL=https://ai.smartbizin.com

# (These were already configured before this session)
JWT_SECRET=...
JWT_REFRESH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
VITE_GOOGLE_CLIENT_ID=...
XAI_API_KEY=...
GEMINI_API_KEY=...
PLUGIN_SSO_SECRET=...
PLUGIN_ALLOWED_ORIGINS=https://ai.smartbizin.com
VITE_PLUGIN_ALLOWED_ORIGINS=https://ai.smartbizin.com
```

**Without `SMTP2GO_API_KEY`**, signup + forgot-password + invitations all
return **503** and the boot logs:
```
[mailer] SMTP2GO_API_KEY is not set — signup OTP + invite emails will fail until it is configured
```

---

## 5. Files to read first when resuming

In priority order:

1. **This file** — `.planning/sessions/SESSION-CONTEXT-LATEST.md`
2. **Earlier day's context** — `.planning/sessions/SESSION-2026-04-11.md`
3. **ITR feature plan** — `.planning/sessions/ITR-FILING-FEATURE-PLAN.md`
4. **Most recent plan** (email OTP + invites + phone + forgot) —
   `C:/Users/Prattush/.claude/plans/validated-greeting-matsumoto.md`
5. `server/lib/billing.ts` — the shared-pool model
6. `server/middleware/auth.ts` — the three middleware layers
7. `src/contexts/AuthContext.tsx` — client auth state + User type
8. `src/App.tsx` — view routing, canAccessItr gate, ?invite= interception

---

## 6. Local dev DB state (as of writing)

Admin users present:
- `prattyush.jain@gmail.com` — role=admin, plan=enterprise, password set by
  first boot seed (see db/index.ts bottom)
- `yogiclear@gmail.com` — role=admin, plan=enterprise, **created manually
  in local dev only**, temp password `0202c2c7936e7c12` (not on production)

If you want to clean up the local-only test admin:
```bash
node -e "const db=require('better-sqlite3')('data/tax-assistant.db'); console.log('deleted', db.prepare('DELETE FROM users WHERE email=?').run('yogiclear@gmail.com').changes);"
```

---

## 7. Deployment checklist — what production needs to catch up

1. `git pull` from the branch with all this work
2. `npm install` (adds `nodemailer` + `@types/nodemailer` — now dead weight,
   can remove later since the mailer uses raw fetch + REST API)
3. `npm run build` — **critical** for the ITR tab, new profile page, new
   auth pages, and TeamSection to appear in the served bundle
4. Restart PM2: `pm2 reload ecosystem.config.cjs` — runs migrations on boot
   (adds `phone`, `email_verified`, `inviter_id`, `itr_enabled`,
   `billing_user_id` x6, creates `email_verification_codes`, `invitations`,
   `profiles`, `itr_drafts` tables, grandfathers existing users to
   `email_verified = 1`, rebuilds `email_verification_codes` if legacy
   CHECK constraint present)
5. Set the SMTP2GO env vars (see §4)
6. `pm2 reload` one more time to pick up env changes
7. Grant ITR access to whoever needs it via `grant-itr.ts`
8. Ask admins to **hard-refresh** (Ctrl/Cmd+Shift+R) so their browser pulls
   the new bundle with the ITR tab visible

Signal the migrations ran correctly by checking boot logs for:
```
[DB] SQLite initialized at ...
[DB] Rebuilt email_verification_codes without legacy purpose CHECK  # only first time
[mailer] SMTP2GO API configured (from: no-reply@assist.smartbizin.com)
[ITR] ITR-1 schema compiled
[ITR] ITR-4 schema compiled
[RAG] Total chunks: 7100, index keys: 39342
[API] Server running on :4001 (development)
```

---

## 8. Planned features to start in the new session

1. **Board resolution wizard** — new top-level feature, needs plan first. See
   §1.1.
2. **26AS master-data import** — biggest new feature, needs plan first. See
   §1.2.
3. **Fix ITR wizard tax calculation** — §2.1. Medium surgical fix, probably
   ~100 lines in `toCbdtJson.ts` + wiring to `taxEngine.ts`. Depends on #4
   if you want surcharge support in the ITR output.
4. **Add surcharge + marginal relief + rate display to the Income Tax
   calculator** — §2.2. ~50-80 lines in `taxEngine.ts` + ~30 lines of UI in
   `RegimeComparison.tsx`.

Suggested execution order: **4 → 3 → 2 → 1**. (Surcharge engine fix first
since ITR wizard depends on it; then ITR calc fix; then 26AS since it
touches the largest surface; then resolution wizard which is greenfield.)

---

## 9. Things to be careful of in this codebase

1. **Two pre-existing TypeScript errors in `server/routes/auth.ts` at lines
   29 and 34** — jsonwebtoken overload mismatches. Do NOT touch. Runtime
   behavior is correct. They're flagged in `SESSION-2026-04-11.md` §5.
2. **`GoogleSignInButton` crashes the React tree when `VITE_GOOGLE_CLIENT_ID`
   is empty.** This is why the local dev preview shows an empty root after
   hitting the login page. Pre-existing, not a regression from this session's
   work. Production has the env var set so it's fine there.
3. **Never add `CREATE INDEX` to `schema.sql` for a new column.** `CREATE
   TABLE IF NOT EXISTS` is a no-op on existing DBs, so the ALTER has to run
   first — indexes go in `db/index.ts` inside the migration block. There's
   a comment at the top of `users` table in schema.sql reminding of this.
4. **Usage counting is post-response in most routes** — chat logs after the
   stream completes, notices after generation, etc. Don't change this to
   pre-response without understanding that failed requests currently don't
   count against quota (resilient pattern).
5. **`/api/invitations/accept` is PUBLIC** — mounted in `server/index.ts`
   BEFORE `app.use('/api', authMiddleware)`. If you add new auth-required
   invitation routes, mount them on the inner `invitationsRouter` (mounted
   after authMiddleware). Mixing the two will accidentally either auth-gate
   the public accept or open up the authed routes.
6. **Profile PAN is not enforced unique** at the DB level — users can
   currently create two profiles with the same PAN. The 26AS import feature
   needs to handle this (probably by adding a uniqueness check at upsert
   time, scoped to `user_id`).
7. **Client-side gates are cosmetic.** All real access control must live in
   server middleware. The `canAccessItr` check in `App.tsx`/`Sidebar.tsx`/
   `Header.tsx` just hides the nav entry — `itrAccessMiddleware` on the
   server is the authoritative gate. Similar for `adminMiddleware`.
8. **Google / plugin SSO users skip email verification** — they're implicitly
   trusted. See `isVerificationExempt()` in `auth.ts`. Phone-only users also
   skip (their "email" is `<digits>@phone.local`). If you add another SSO
   provider, extend `isVerificationExempt`.

---

## 10. Commit status

As of writing, nothing in this session has been `git commit`ed. Run
`git status` + `git diff --stat` to see the full file list before
committing. Suggested logical commit groupings (from earliest to latest):

1. **ITR Filing feature** — server/lib/itr/*, server/db/repositories/itrDraftRepo.ts,
   server/routes/itr.ts, src/components/itr/*, package.json (ajv deps)
2. **Generic profiles + calculator tab state fix** — server/db/repositories/profileRepoV2.ts,
   server/routes/genericProfiles.ts, src/components/profile/*,
   src/hooks/useProfileManager.ts, src/contexts/TaxCalculatorContext.tsx,
   src/components/calculator/*
3. **Email OTP + SMTP2GO + team invites** — server/lib/mailer.ts,
   server/lib/billing.ts, server/db/repositories/{verificationRepo,invitationRepo}.ts,
   server/routes/{invitations,auth}.ts, server/routes/admin.ts,
   src/components/auth/{VerifyEmailPage,AcceptInvitePage}.tsx,
   src/components/settings/TeamSection.tsx, schema.sql, db/index.ts
4. **Phone login + plugin-sso v11** — server/routes/auth.ts (plugin-sso),
   src/components/auth/LoginPage.tsx
5. **Forgot password** — server/routes/auth.ts, server/lib/mailer.ts,
   src/components/auth/ForgotPasswordPage.tsx, src/components/auth/AuthGuard.tsx
6. **SMTP2GO REST migration** — server/lib/mailer.ts full rewrite
7. **ITR access capability** — server/db/index.ts, server/db/repositories/userRepo.ts,
   server/middleware/auth.ts, server/routes/itr.ts, server/routes/auth.ts (toUserResponse),
   server/routes/invitations.ts (toUserResponse), src/contexts/AuthContext.tsx,
   src/App.tsx, src/components/layout/{Sidebar,Header}.tsx, server/scripts/grant-itr.ts

Or commit as one big "v1.3 — team features + ITR wizard + profile system"
batch if you prefer coarse history.
