# Feature Research

**Domain:** Indian Tax Assistant Web App (Chat + Calculator + Document Handling + Visualization + Iframe Plugin)
**Researched:** 2026-04-04
**Confidence:** MEDIUM-HIGH (verified against live competitor products; AI-specific document handling flags remain LOW confidence pending Gemini Files API testing)

---

## Context: Existing vs. New Features

This research focuses exclusively on the **new milestone features**. Existing validated features (chat UI, dark/light mode, basic bar/pie charts, markdown tables, responsive layout, quick shortcuts, basic `?plugin=true` mode) are out of scope.

New feature areas under research:
1. **Tax Calculators** — Old vs New regime, capital gains, GST
2. **Document Handling** — Form 16, salary slip parsing, general doc Q&A
3. **Interactive Tax Dashboard** — Enhanced visualization, deduction/income breakdown
4. **Iframe Plugin Mode** — Production-grade embedding in Smart Assist

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Old vs New regime comparison side-by-side | Every major Indian tax tool (ClearTax, Groww, IT portal) does this; FY 2025-26 changes make regime choice critical | MEDIUM | Show tax under both regimes simultaneously; auto-recommend the lower-tax regime |
| Income slabs input: salary, gross income, age category | Standard inputs across all calculators; age determines senior/super-senior citizen thresholds | LOW | Salaried / Business / Senior Citizen tabs; age bracket (below 60, 60-80, 80+) |
| Standard deduction auto-applied | ₹75,000 (new regime) / ₹50,000 (old regime) for salaried — users expect this to be automatic, not a manual input | LOW | Apply automatically based on regime; surfacing it explicitly helps trust |
| Major Section 80 deductions in old regime | 80C (₹1.5L), 80D health insurance (₹25K/₹50K), 80CCD(1B) NPS (₹50K), HRA exemption — users planning old regime investments need these | MEDIUM | HRA requires separate sub-calculator (basic, DA, HRA received, rent paid, metro/non-metro) |
| Final tax payable with cess (4%) | No tax tool omits health and education cess; users expect the real bottom-line number | LOW | Total tax = slab tax + surcharge (if applicable) + 4% cess |
| Rebate u/s 87A auto-applied | New regime: income ≤ ₹12L → zero tax via 87A. Users will be confused if this is not automatic | LOW | New regime 87A: up to ₹60,000 rebate; effectively zero tax up to ₹12L for FY 2025-26 |
| Capital gains: LTCG vs STCG with asset type | Users with equity, MF, property, or gold holdings expect a dedicated capital gains calculator; rates differ by asset class | MEDIUM | Equity/MF STCG = 20%, LTCG = 12.5% (exemption ₹1.25L); real estate LTCG = 12.5% without indexation |
| GST: intra-state (CGST+SGST) vs inter-state (IGST) split | Any business-oriented user will expect this; it is the first thing every GST tool shows | LOW | Simple input: amount + GST rate + transaction type → breakdown |
| Form 16 PDF upload and parsing | ITR filing apps (ClearTax, TaxBuddy) have popularized this; users expect to upload and get their tax picture auto-populated | HIGH | Form 16 PDFs from TRACES are often password-protected (PAN+DOB format); Part A (TDS summary) + Part B (salary breakdown) must both be parsed |
| Extracted fields summary display | After document upload, users expect to see what was extracted: salary, TDS, deductions, net taxable income | MEDIUM | Show a structured summary card, not raw extracted text |
| Chat Q&A on uploaded document | "What is my taxable income from this Form 16?" — document-aware follow-up queries are the main value of multimodal AI | MEDIUM | Requires passing document context through to Gemini; Gemini API supports Files API (50MB limit) |
| Tax breakdown chart (income → deductions → taxable → tax) | Users expect to see their tax graphically once they run a calculation — already exists as bar/pie, but the flow must be tied to the calculator | LOW | Waterfall chart or stacked bar most natural for income → deductions → taxable income → tax flow |
| Responsive layout in iframe embed | Smart Assist will render this inside a constrained panel; it must not overflow or break at 320–480px widths | LOW | Already partially handled by existing responsive layout; iframe mode needs tighter testing |
| postMessage API for iframe height | Parent page cannot know the iframe's content height without explicit communication; scroll bars inside iframes are a bad UX | MEDIUM | Use `window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, targetOrigin)` |

---

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Regime recommendation with "switch savings" callout | Not just showing both — explicitly telling the user "switch to new regime and save ₹X" is more actionable than ClearTax's passive display | LOW | Trivially computed from side-by-side calc; high perceived value |
| Deduction gap analysis (80C, 80D, NPS unused capacity) | Show how much of each deduction limit is used vs available: "You have ₹60K unused 80C capacity — invest in ELSS to save ₹18,600 more tax" | MEDIUM | Only meaningful in old regime; helps users plan before March 31 deadline |
| Capital gains holding-period optimizer | "If you hold 3 more months, this gain qualifies for LTCG rate (12.5% vs 20% STCG)" — Groww and Fisdom show this but not many pure calculators do | MEDIUM | Requires purchase date + current date + expected sale date logic |
| Chat-to-calculator pre-fill | User asks "what if my salary is 15 lakhs?" in chat → calculator auto-opens with 15L pre-filled | MEDIUM | Requires postMessage-style internal state bridge between chat and calculator views |
| GST HSN code lookup via AI | User describes a product in plain English → Gemini suggests HSN code + applicable GST rate | LOW | Already within Gemini's capability; differentiates from plain calculators |
| Document comparison Q&A (multi-year) | Upload Form 16 from two years: "Did my effective tax rate improve?" — no mainstream tool does cross-year document comparison | HIGH | Requires multi-file context in Gemini; complex UX; defer to v2 |
| Theme sync with parent via postMessage | Smart Assist parent can send `{ type: 'theme', value: 'dark' }` → iframe switches theme to match parent | LOW | postMessage listener for theme event; already have dark/light toggle; wires up naturally |
| Surcharge calculation for high incomes | Users earning above ₹50L/₹1Cr/₹2Cr face surcharge; most simple calculators get this right but many miss marginal relief | MEDIUM | Important for high-income users; adds credibility |

---

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| ITR form submission / e-filing integration | Users want end-to-end filing in one place | Requires TRACES/Income Tax portal API access, digital signatures, legal liability; ITR forms change every year requiring constant maintenance; AI tax advice errors become legal exposure | Keep explicitly advisory: "This calculator shows your estimated liability; file via the official portal" with a direct link to incometax.gov.in |
| Real-time AIS / 26AS data fetch | Users want auto-imported TDS data | Requires taxpayer credentials (PAN + password) for the IT portal; storing or proxying these is a security and legal liability | Accept manual entry or Form 16 upload instead |
| Multi-file document batch processing | Power users want to upload 10 salary slips at once | Gemini Files API has per-request context limits; batch processing needs queue management, error recovery, storage — backend complexity multiplies significantly for uncertain benefit | Limit to one primary document + optional supplementary document per session |
| Exact tax opinion / advice ("you must do X") | Users want prescriptive guidance | AI hallucination in tax context = potential financial harm; SEBI/IT dept have no formal chatbot certification framework | Frame all outputs as estimates and suggestions; include "consult a CA for your specific situation" disclaimer on calculators and document analysis |
| Persistent tax history / year-over-year tracking | Users want to track taxes across years | Requires user authentication, backend storage, GDPR-equivalent data handling — out of scope for v1 with no auth system | Provide export/copy functionality per session; defer accounts to v2 |
| Live stock price integration for capital gains | Users want to enter ticker symbol → auto-fill purchase/sale price | Requires stock price API subscription (NSE/BSE data not free); adds dependency on external uptime | Ask users to enter amounts manually; this is a one-time calculation |
| Salary slip OCR for non-digital documents | Users want to photograph a printed slip | Mobile camera OCR for complex layouts is unreliable; Gemini vision works better with clean digital PDFs | Accept only PDF/image uploads of clean digital documents; document clearly that scanned/handwritten docs may have lower accuracy |

---

## Feature Dependencies

```
[Express Backend Proxy]
    └──required-by──> [Document Upload & Analysis]
                          └──enhances──> [Calculator Pre-fill from Document]
    └──required-by──> [Gemini Files API (server-side)]

[Tax Calculator UI]
    └──enhances──> [Tax Dashboard Visualization]
    └──enables──> [Regime Recommendation Callout]
    └──enables──> [Deduction Gap Analysis]

[Old vs New Regime Calculator]
    └──required-by──> [Capital Gains Calculator]
        (capital gains interact with slab calculation and 87A rebate eligibility)

[Chat Interface (existing)]
    └──enhances──> [Document Q&A]
    └──enables──> [Chat-to-Calculator Pre-fill] (differentiator)

[Existing ?plugin=true Mode]
    └──replaced-by──> [Production Iframe Plugin Mode]
        └──requires──> [postMessage Height Resize]
        └──requires──> [postMessage Theme Sync]

[Document Upload (Form 16)]
    └──requires──> [Express Backend]
        (API key must not be exposed; file upload must not go directly to client-side Gemini call)
```

### Dependency Notes

- **Document upload requires Express backend:** Gemini Files API calls with multipart uploads must be server-side to keep the API key hidden. Client-side upload directly to Gemini exposes the key.
- **Capital gains requires Old/New regime base calc:** Capital gains are computed separately but feed into total tax liability and 87A rebate eligibility check (LTCG under 112A is excluded from 87A rebate — this edge case breaks simple calculators).
- **Production iframe mode requires postMessage infrastructure:** The existing `?plugin=true` hides UI chrome but does not communicate height or theme to the parent. Smart Assist embedding needs both.
- **Tax dashboard is a view layer over calculator outputs:** The dashboard does not need its own data model — it renders calculator results and document-extracted data as charts. Build calculator first.

---

## MVP Definition

This milestone's MVP (v1.0) — minimum needed to ship the new milestone coherently:

### Launch With (v1.0)

- [ ] **Express backend proxying Gemini API** — security prerequisite for everything else; API key cannot remain in client bundle
- [ ] **Old vs New regime income tax calculator** — core calculator; regime comparison is the single most-requested Indian tax feature
- [ ] **Section 80C / 80D / HRA deduction inputs (old regime)** — old regime is meaningless without these; new regime needs only income + standard deduction
- [ ] **Rebate 87A auto-application and cess calculation** — without these, tax figures will be wrong and erode user trust
- [ ] **Capital gains sub-calculator (equity + real estate)** — high user demand; rates changed in Budget 2024-25 (LTCG 12.5%, STCG 20%) so users are actively recalculating
- [ ] **GST calculator (basic: amount + rate + type)** — table stakes for business-oriented users; 30 minutes to implement
- [ ] **Tax breakdown visualization tied to calculator output** — connects existing chart capability to new calculator; waterfall or stacked bar
- [ ] **Form 16 PDF upload and parsed summary display** — highest perceived value document feature; most users have Form 16 from employer
- [ ] **Document-aware chat Q&A (document context passed to Gemini)** — the AI differentiator; plain upload without chat is just a PDF viewer
- [ ] **postMessage height resize for iframe** — without this, Smart Assist embedding will have broken scrolling; must ship with iframe mode
- [ ] **Production iframe cleanup (hide chrome, lock scroll, theme param)** — the existing plugin mode is prototype-grade; Smart Assist needs production behavior

### Add After Validation (v1.x)

- [ ] **Regime recommendation callout with exact savings figure** — easy win once base calculator works; add after verifying calculation accuracy
- [ ] **Deduction gap analysis (unused 80C/80D/NPS capacity)** — valuable but requires base calculator to be stable first
- [ ] **postMessage theme sync from parent** — low effort but test Smart Assist integration first to confirm it is needed
- [ ] **Salary slip document upload** — structure is less standardized than Form 16; add after Form 16 parsing pipeline is stable
- [ ] **Capital gains holding-period optimizer hint** — add to capital gains calculator after base calc ships

### Future Consideration (v2+)

- [ ] **Chat-to-calculator pre-fill bridge** — requires internal state architecture decision; coordinate with routing/navigation phase
- [ ] **GST HSN code AI lookup** — differentiator; not blocking any current user flow
- [ ] **Multi-year document comparison** — high complexity; requires multi-file Gemini context management
- [ ] **Surcharge marginal relief calculation** — important for >₹50L earners but edge case for MVP audience
- [ ] **User accounts + tax history persistence** — requires auth system; out of scope for stateless v1

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Express backend proxy | HIGH (security blocker) | LOW | P1 |
| Old vs New regime calculator | HIGH | MEDIUM | P1 |
| 80C / 80D / HRA deduction inputs | HIGH | MEDIUM | P1 |
| 87A rebate + cess auto-application | HIGH (correctness) | LOW | P1 |
| Capital gains LTCG/STCG calculator | HIGH | MEDIUM | P1 |
| Form 16 PDF upload + summary | HIGH | HIGH | P1 |
| Document-aware chat Q&A | HIGH | MEDIUM | P1 |
| Tax breakdown chart (calculator-linked) | MEDIUM | LOW | P1 |
| postMessage height resize | HIGH (embed correctness) | LOW | P1 |
| Production iframe cleanup | MEDIUM | LOW | P1 |
| GST calculator (basic) | MEDIUM | LOW | P1 |
| Regime recommendation callout | MEDIUM | LOW | P2 |
| Deduction gap analysis | MEDIUM | MEDIUM | P2 |
| postMessage theme sync | LOW | LOW | P2 |
| Salary slip upload | MEDIUM | MEDIUM | P2 |
| Capital gains holding-period hint | LOW | LOW | P2 |
| Chat-to-calculator pre-fill | MEDIUM | HIGH | P3 |
| GST HSN code AI lookup | LOW | LOW | P3 |
| Multi-year document comparison | LOW | HIGH | P3 |
| Surcharge marginal relief | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when P1 is stable
- P3: Nice to have, future milestone

---

## Competitor Feature Analysis

| Feature | ClearTax | Groww | IT Dept Portal | Our Approach |
|---------|----------|-------|----------------|--------------|
| Old vs New comparison | Yes, side-by-side | Yes, tabbed | Yes (basic) | Side-by-side with recommendation callout |
| Capital gains calculator | Yes, LTCG/STCG with asset types | Yes | No | Yes, asset-type selector with holding period |
| Form 16 upload | Yes (core product) | No | TRACES upload only | Yes, via Express + Gemini multimodal |
| Chat/AI Q&A | No (forms-based) | No | Karsati (limited) | Core differentiator — AI-native |
| GST calculator | Separate section | No | CBIC portal | Integrated as calculator tab |
| Dashboard visualization | Limited | Portfolio charts | Minimal | Waterfall + stacked bar tied to calculator |
| Iframe embed | No | No | No | Smart Assist target use case |
| Deduction optimizer | Yes (guided) | No | No | As differentiator after base calc |
| Theme sync | N/A | N/A | N/A | postMessage-based for Smart Assist |

---

## Indian Tax Domain: User Behavior Expectations

Based on research into how Indian taxpayers interact with tax tools:

**Calculator expectations:**
- Users want instant results — no "submit" page reload; calculate on input change (or on a single "Calculate" button tap for mobile)
- Most users know their gross salary but not their exact taxable income; the calculator must do the decomposition
- March–July is peak usage (advance tax deadlines + ITR filing season); users are in "planning mode" before March and "filing mode" after April
- New regime defaulted since April 2023 by IT dept; calculators should default to new regime but make switching easy

**Document upload expectations:**
- Users expect upload → instant extraction → review → refine; they do not want to re-enter data from a document they just uploaded
- Form 16 password protection is a known friction point; users expect a password prompt if extraction fails, not a generic error
- Privacy concern is high for salary/tax documents; users want clarity on whether files are stored (they should not be for v1)

**Iframe/embed expectations:**
- Smart Assist users will not know they are in an iframe; the embedded app must feel native to the parent
- Theme mismatch (dark parent + light iframe) is visually jarring and the #1 embed UX complaint
- Scroll behavior: content inside the iframe should not create double scrollbars; height-auto via postMessage is the correct solution

---

## Sources

- [ClearTax Income Tax Calculator](https://cleartax.in/paytax/taxcalculator) — feature set reference
- [Groww Income Tax Calculator](https://groww.in/calculators/income-tax-calculator) — Old vs New regime UI pattern
- [IT Department Old vs New Regime Tool](https://incometaxindia.gov.in/Pages/tools/old-regime-vis-a-vis-new-regime.aspx) — official baseline
- [ClearTax LTCG Calculator](https://cleartax.in/s/ltcg-calculator) — capital gains feature reference
- [ClearTax Income Tax Slabs FY 2025-26](https://cleartax.in/s/income-tax-slabs) — current rate verification
- [GST Calculator India 2025 — TaxCalculators.in](https://www.taxcalculators.in/calculators/gst-calculator) — GST feature reference
- [Gemini PDF Analysis — Firebase](https://firebase.google.com/docs/vertex-ai/analyze-documents) — document handling capabilities
- [Google Gemini PDF Limits — DataStudios](https://www.datastudios.org/post/google-gemini-pdf-reading-file-size-limits-parsing-features-cloud-uploads-and-automation-workflo) — 50MB limit, base64 inflation, Firebase 20MB cap
- [React iframes Best Practices — LogRocket](https://blog.logrocket.com/best-practices-react-iframes/) — iframe postMessage patterns
- [postMessage iframe resize — Dev.to](https://dev.to/tvanantwerp/how-to-resize-iframes-with-message-events-2fec) — height resize implementation
- [AI Tax Chatbot Pitfalls — CNBC](https://www.cnbc.com/2026/03/31/ai-tax-help-pitfalls.html) — anti-features and accuracy risks
- [TaxBuddy ITR App Features 2025](https://www.taxbuddy.com/blog/itr-filing-mobile-app-india) — Form 16 auto-import baseline
- [Form 16 Sample PDF — IT Dept](https://eportal.incometax.gov.in/iec/foservices/assets/pdf/1_Form16_Sample.pdf) — Part A/B field structure

---

*Feature research for: Indian Tax Assistant — v1.0 milestone (Express backend, visualizations, calculator, document handling, iframe plugin)*
*Researched: 2026-04-04*
