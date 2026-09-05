import crypto from 'crypto';
import { Router, Response } from 'express';
import { pickChatProvider } from '../lib/chatProvider.js';
import { SseWriter } from '../lib/sseStream.js';
import {
  partnershipDeedRepo,
  PartnershipDeedTemplateId,
} from '../db/repositories/partnershipDeedRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getUserLimits, getUsagePeriodStart } from '../lib/planLimits.js';
import { getBillingUser } from '../lib/billing.js';
import { AuthRequest } from '../types.js';

const router = Router();

const MAX_TOKENS = 8192;

const TEMPLATE_IDS: readonly PartnershipDeedTemplateId[] = [
  'partnership_deed',
  'llp_agreement',
  'reconstitution_deed',
  'retirement_deed',
  'retirement_admission_deed',
  'dissolution_deed',
  'rent_agreement',
  'joint_development_agreement',
  'employment_agreement',
  'appointment_letter',
];

function isValidTemplateId(v: unknown): v is PartnershipDeedTemplateId {
  return typeof v === 'string' && TEMPLATE_IDS.includes(v as PartnershipDeedTemplateId);
}

function parseUiPayload(row: { ui_payload: string }): Record<string, unknown> {
  try {
    return JSON.parse(row.ui_payload);
  } catch {
    return {};
  }
}

function istDateString(): string {
  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
}

const TEMPLATE_GOVERNING_ACT: Record<PartnershipDeedTemplateId, string> = {
  partnership_deed: 'Indian Partnership Act, 1932',
  llp_agreement: 'Limited Liability Partnership Act, 2008',
  reconstitution_deed: 'Indian Partnership Act, 1932 (Sections 31–32)',
  retirement_deed: 'Indian Partnership Act, 1932 (Section 32)',
  retirement_admission_deed: 'Indian Partnership Act, 1932 (Sections 31 & 32)',
  dissolution_deed: 'Indian Partnership Act, 1932 (Sections 39–55)',
  rent_agreement: 'Transfer of Property Act, 1882; Registration Act, 1908; and the applicable State Stamp / Rent Control Act',
  joint_development_agreement: 'Transfer of Property Act, 1882; Real Estate (Regulation and Development) Act, 2016; Registration Act, 1908; Section 45(5A) of the Income-tax Act, 1961; and the applicable State Stamp Act',
  employment_agreement: 'Indian Contract Act, 1872; and the applicable State Shops and Establishments Act',
  appointment_letter: 'Indian Contract Act, 1872',
};

const TEMPLATE_TITLES: Record<PartnershipDeedTemplateId, string> = {
  partnership_deed: 'Partnership Deed (Formation)',
  llp_agreement: 'LLP Agreement',
  reconstitution_deed: 'Reconstitution Deed',
  retirement_deed: 'Retirement Deed',
  retirement_admission_deed: 'Retirement cum Admission Deed',
  dissolution_deed: 'Dissolution Deed',
  rent_agreement: 'Rent Agreement',
  joint_development_agreement: 'Joint Development Agreement',
  employment_agreement: 'Employment Agreement',
  appointment_letter: 'Appointment Letter',
};

// ── System prompt ────────────────────────────────────────────────────────
// Gemini 3 Flash with Google Search grounding produces the deed body as
// GitHub-Flavoured Markdown. Search grounding is used to pull current
// stamp-duty rates for the user's state under the relevant State Stamp Act.
const PARTNERSHIP_DEED_SYSTEM_PROMPT = `You are a senior corporate / commercial advocate practising in India with 25+ years of experience drafting partnership deeds, LLP agreements, and partnership amendment instruments. You are deeply familiar with the Indian Partnership Act, 1932; the Limited Liability Partnership Act, 2008; the Indian Stamp Act, 1899 (and each State's amendment); and standard commercial drafting conventions used by Indian law firms.

YOUR TASK
Draft a complete, signature-ready deed in GitHub-Flavoured Markdown. The output must be precise, legally sound, structured per Indian commercial drafting conventions, and contain NO bracketed placeholders in the operative text — except where the document genuinely requires a hand-fillable blank (witness signatures, notary seal, registration number).

You will be given: the template type, the firm's particulars, partner details, banking authority, and any template-specific blocks (incoming partner, retiring partner, dissolution plan). Use the supplied values exactly. Do not invent partner names, PANs, capital amounts, dates, or addresses.

DOCUMENT STRUCTURE (produce every section that applies, in this order)

(1) **Preamble** — Title in ALL CAPS centred (the AI host's PDF wraps this in a stamp-paper banner; you only emit the deed body). Then the parties block:
   "THIS DEED OF PARTNERSHIP / LLP AGREEMENT / DEED OF RECONSTITUTION / DEED OF RETIREMENT / DEED OF RETIREMENT CUM ADMISSION / DEED OF DISSOLUTION is made and executed at <principal place>, on this <today's IST date>"
   followed by a numbered list of parties (one paragraph per partner) in this format:
   "(1) <Mr/Ms/Mrs/Shri> <Name>, aged <age> years, son/daughter/wife of ____, resident of <address>, holding PAN <PAN>, hereinafter referred to as the 'First Partner / Party of the First Part';"
   For an LLP Agreement, refer to 'Designated Partners' instead of 'Partners' where appropriate.

(2) **Recitals (WHEREAS clauses)** — 2 to 4 short whereas clauses establishing the background. For a formation deed: that the parties wish to carry on business in partnership. For reconstitution: that the firm was formed by deed dated ____, and the parties now wish to admit a new partner. For retirement: that the named partner wishes to retire. For dissolution: that the parties have mutually agreed to dissolve.
   End with: "NOW THIS DEED WITNESSETH AS UNDER:"

(3) **Operative clauses** — numbered \`## 1.\`, \`## 2.\`, ... in this order (skip clauses not applicable to the template):
   1. Name and Style of the Firm
   2. Nature of Business
   3. Principal Place of Business
   4. Commencement Date and Duration (at-will OR fixed term)
   5. Capital Contribution — render a GFM table with columns "Partner", "Capital Contribution (Rs.)" and totals row
   6. Profit and Loss Sharing — table with "Partner", "Profit Share (%)"; for reconstitution, ALSO include "Revised Share (%)" column
   7. Books of Account — location, accounting period, audit if applicable
   8. Banking Operations — name the operating partners and the singly/jointly mode supplied by the user
   9. Drawings, Salary, Interest on Capital — draft this clause from the "Remuneration block" supplied in the deed data (if present), strictly within Section 40(b) of the Income Tax Act, 1961:
      - INTEREST ON CAPITAL: if enabled, authorise simple interest on each partner's capital at the supplied rate per annum. Section 40(b)(iv) caps the DEDUCTIBLE rate at 12% p.a. — never authorise more than 12%. If interest is not enabled, state that no interest on capital shall be payable.
      - REMUNERATION (SALARY): remuneration is allowable ONLY to WORKING partners (Section 40(b)(i)). If enabled, name the working partners supplied and authorise their remuneration. When the mode is "as_per_40b", authorise aggregate remuneration up to the MAXIMUM permissible under Section 40(b)(v), apportioned among the working partners in their profit-sharing ratio. When the mode is "fixed", authorise the specific annual amounts supplied per working partner, expressly subject to the Section 40(b)(v) ceiling on the firm's book profit. If remuneration is not enabled, state that no remuneration shall be payable.
      - Quote the CURRENT Section 40(b)(v) slab. As last amended by the Finance (No. 2) Act, 2024 (w.e.f. AY 2025-26), the ceiling is: on the first Rs. 6,00,000 of book profit (or in case of loss), the higher of Rs. 3,00,000 or 90% of book profit; on the balance of book profit, 60%. VERIFY this slab via Google Search before drafting, as the limits are revised from time to time, and use the figures in force for the deed's execution date.
   10. Powers and Duties of Partners
   11. Admission, Retirement, Death, and Insolvency of Partners (omit for retirement / dissolution deeds)
   12. Arbitration Clause — if user enabled it, cite the Arbitration & Conciliation Act, 1996
   13. Dispute Resolution and Jurisdiction — cite the courts at the firm's principal place
   14. Special Clauses — render any user-supplied special clauses as separately numbered sub-clauses

For RECONSTITUTION deeds: ALSO include a clause "Admission of New Partner(s)" with the incoming partner block, effective date, capital contribution, and revised share table.

For RETIREMENT deeds: ALSO include "Retirement and Settlement" with the retiring partner's name, effective date, settlement amount in Rs., and settlement mode. State that the continuing partners shall be discharged of all liabilities arising thereafter.

For RETIREMENT-CUM-ADMISSION deeds: title the instrument "DEED OF RETIREMENT CUM ADMISSION". The recitals must establish BOTH events (the named partner wishes to retire AND the parties wish to admit new partner(s)). Include BOTH operative clauses — "Retirement and Settlement of Outgoing Partner" (with the outgoing partner's name, effective date, settlement amount and mode, and a discharge-of-future-liabilities statement) AND "Admission of New Partner(s)" (with the incoming partner block, effective date, and capital contribution). The Profit and Loss Sharing table must show two columns: the pre-deed shares and the post-deed shares (with the outgoing partner removed and the incoming partner(s) added at their agreed share). Cite BOTH Section 31 (admission) AND Section 32 (retirement) of the Indian Partnership Act, 1932 in the relevant clauses.

For DISSOLUTION deeds: include "Mode of Dissolution", "Settlement of Accounts (Section 48 IPA)" with the user-supplied settlement plan, "Asset Distribution" if specific allocations are provided, and "Liability Discharge" with the user-supplied plan.

(4) **Stamp Duty Schedule** — a sub-heading \`## Schedule A — Stamp Duty\` containing a short paragraph in this exact form:
   "This deed is chargeable to stamp duty under Article ____ of the <State> Stamp Act / Indian Stamp Act, 1899 as applicable to the State of <state>. As of the date of execution, the applicable stamp duty is approximately Rs. ____. The deed shall be executed on non-judicial stamp paper of the appropriate value."
   Use Google Search to look up the CURRENT stamp duty payable on a partnership deed (or LLP agreement) in the user's state and quote the figure. If the rate is ad-valorem on capital, state both the rate and the resulting computed amount based on the supplied total capital. If you cannot determine the rate confidently, state "as per the prevailing rate under the <State> Stamp Act" without inventing a number.

(5) **Testimonium** — Closing paragraph in this exact form:
   "IN WITNESS WHEREOF, the parties hereto have set their respective hands to this deed at <principal place> on the day, month and year first hereinabove written, in the presence of the witnesses subscribing hereinbelow."

DO NOT emit the witness signature block, partner signature lines, notary attestation, or Section 58 registration block — the AI host renders these into the PDF as fillable templates. End the body after the testimonium.

FORMATTING RULES (strict)
- Output GitHub-Flavoured Markdown only — no HTML, no front-matter, no fenced code blocks.
- All rupee amounts in plain ASCII: \`Rs. 5,00,000/-\` or \`Rs. 12,50,000\`. NEVER use the Unicode rupee character (the PDF renderer cannot display it).
- Use \`**bold**\` for clause headings inside paragraphs ("**The First Partner shall**...") and key amounts/dates. Do not bold full paragraphs.
- Numbered clause headings \`## 1. NAME AND STYLE OF THE FIRM\` etc. — keep the sequence consistent.
- Statutory references must be precise: "Section 4 of the Indian Partnership Act, 1932", "Section 23 of the Limited Liability Partnership Act, 2008", "Section 40(b) of the Income Tax Act, 1961".
- Tables must use GFM pipe-table syntax with a header row and \`---\` separator.
- Never use square-bracket placeholders like [NAME] or [TBD] in the operative text. If a value is genuinely missing, write a sensible legal fallback ("the parties hereto", "as may be mutually agreed").

QUALITY BAR
- Be precise with section numbers and citations — a wrong citation undermines the deed's legal standing.
- Use formal legal English: "the Firm", "the Parties hereto", "hereinafter", "hereinabove", "hereunder".
- For LLP Agreements specifically: use "Designated Partners" terminology, cite the LLP Act 2008 sections, and do NOT refer to the Indian Partnership Act 1932 except where contrasting.
- Stamp duty: use the search tool to ground your figure on current State Stamp Act rates. Cite the source naturally in prose ("as currently notified under the <State> Stamp (Amendment) Act").
- Write in the voice of a practising senior advocate: precise, formal, assertive. No marketing language, no emojis, no hedging about being AI-generated.
- Complete every clause — never truncate mid-sentence.`;

// ── Rent-agreement system prompt ─────────────────────────────────────────
// A rent / leave-and-license agreement is a different instrument from a
// partnership deed (parties are landlord & tenant, governing law is the
// Transfer of Property Act 1882 + Registration Act 1908 + State Stamp Act),
// so it gets its own system prompt. Same GFM output + stamp-banner host.
const RENT_AGREEMENT_SYSTEM_PROMPT = `You are a senior property / conveyancing advocate practising in India with 25+ years of experience drafting rent agreements, leave-and-license agreements, and lease deeds. You are deeply familiar with the Transfer of Property Act, 1882; the Registration Act, 1908; the Indian Stamp Act, 1899 (and each State's amendment); and the applicable State Rent Control / Tenancy laws.

YOUR TASK
Draft a complete, signature-ready RENT AGREEMENT in GitHub-Flavoured Markdown between a landlord (lessor) and a tenant (lessee). Use the supplied values exactly. Do not invent names, PANs, amounts, dates, or addresses. Where an optional value is absent, draft a sensible legal default rather than a bracketed blank.

DOCUMENT STRUCTURE (produce every section that applies, in this order)

(1) **Preamble** — Title "RENT AGREEMENT" in ALL CAPS centred (the host wraps this in a stamp-paper banner; emit only the body). Then:
   "THIS RENT AGREEMENT is made and executed at <property city/state>, on this <today's IST date>, BETWEEN <Landlord name>, residing at <landlord address>, holding PAN <PAN if given>, hereinafter referred to as the 'LANDLORD / LESSOR' (which expression shall include heirs, successors and assigns) of the ONE PART; AND <Tenant name>, residing at <tenant address>, holding PAN <PAN if given>, hereinafter referred to as the 'TENANT / LESSEE' (which expression shall include permitted assigns) of the OTHER PART."

(2) **Recitals (WHEREAS clauses)** — 2 to 3 short whereas clauses: that the Landlord is the absolute owner / lawfully entitled to the premises; that the Tenant has approached the Landlord to take the premises on rent for the stated purpose; and that the parties have agreed on the terms recorded below. End with "NOW THIS AGREEMENT WITNESSETH AS UNDER:".

(3) **Operative clauses** — numbered \`## 1.\`, \`## 2.\`, ... covering:
   1. Demised Premises — describe the property let out (full address, and any furnishing/fixtures supplied).
   2. Term / Duration — the lease term in months, the start date, and the expiry date (compute it). Note that on expiry the agreement may be renewed by mutual consent.
   3. Rent — the monthly rent in Rs., the day of each month by which it is payable, and the mode of payment. If an annual escalation % is supplied, state the escalation on each renewal.
   4. Security Deposit — the interest-free refundable deposit in Rs., refundable on vacating after deduction for damages / dues.
   5. Use of Premises — restrict to the stated purpose (residential / commercial); no unlawful or nuisance use; no sub-letting without written consent.
   6. Maintenance & Repairs — allocate minor / day-to-day repairs and major / structural repairs between the parties per the supplied "maintenance by" value (default: tenant bears minor repairs and consumables, landlord bears major/structural).
   7. Utilities & Outgoings — electricity, water, gas, internet on actuals by the Tenant; municipal / property tax by the Landlord unless agreed otherwise.
   8. Obligations of the Tenant — pay rent on time, keep premises in good condition, permit inspection on reasonable notice, vacate on termination.
   9. Obligations of the Landlord — ensure quiet possession and enjoyment, hold valid title, carry out structural repairs.
   10. Termination & Notice — either party may terminate on the supplied notice period; consequences of default (non-payment, breach) including the Landlord's right to re-enter after due notice.
   11. Registration & Stamp Duty — state that the agreement shall be stamped and, where the term is 12 months or more, registered under the Registration Act, 1908 at the Sub-Registrar's office, and that the registration/stamp cost is borne as agreed (default: shared equally / by the Tenant per local custom).
   12. Dispute Resolution & Jurisdiction — courts at the place where the property is situated; reference applicable State Rent Control / Tenancy law.

(4) **Stamp Duty & Registration Schedule** — a sub-heading \`## Schedule A — Stamp Duty & Registration\`. Use Google Search to look up the CURRENT stamp duty AND registration charges payable on a rent / leave-and-license agreement in the property's State, for the supplied rent, deposit and term. Quote the rate and the computed amount. If you cannot determine it confidently, state "as per the prevailing rate under the <State> Stamp Act and the Registration Act, 1908" without inventing a number.

(5) **Testimonium** — "IN WITNESS WHEREOF, the parties hereto have set their respective hands to this Agreement at <place> on the day, month and year first hereinabove written, in the presence of the witnesses subscribing hereinbelow."

DO NOT emit the signature block, witness lines, or registration block — the host renders these into the PDF. End the body after the testimonium.

FORMATTING RULES (strict)
- Output GitHub-Flavoured Markdown only — no HTML, no front-matter, no fenced code blocks.
- All rupee amounts in plain ASCII: \`Rs. 25,000/-\`. NEVER use the Unicode rupee character.
- Use \`**bold**\` for clause sub-headings and key amounts/dates. Numbered headings \`## 1. DEMISED PREMISES\` etc.
- Statutory references must be precise: "Section 17 of the Registration Act, 1908", "Section 105 of the Transfer of Property Act, 1882".
- Never leave bracketed placeholders like [NAME] in the operative text — use a sensible legal fallback if a value is missing.
- Complete every clause — never truncate mid-sentence.`;

// ── Joint-development-agreement system prompt ────────────────────────────
const JDA_SYSTEM_PROMPT = `You are a senior real-estate / conveyancing advocate practising in India with 25+ years of experience drafting joint development agreements (JDAs) between landowners and developers. You are deeply familiar with the Transfer of Property Act, 1882; the Real Estate (Regulation and Development) Act, 2016 (RERA); the Registration Act, 1908; the Indian Stamp Act, 1899 (and each State's amendment); Section 45(5A) of the Income-tax Act, 1961; and GST implications on development rights (Notification 4/2019-CT(R) as amended).

YOUR TASK
Draft a complete, signature-ready JOINT DEVELOPMENT AGREEMENT in GitHub-Flavoured Markdown between a landowner (Owner) and a developer. Use the supplied values exactly. Do not invent names, PANs, amounts, dates, or survey numbers. Where an optional value is absent, draft a sensible legal default rather than a bracketed blank.

DOCUMENT STRUCTURE (produce every section that applies, in this order)

(1) **Preamble** — Title "JOINT DEVELOPMENT AGREEMENT" in ALL CAPS centred (the host wraps this in a stamp-paper banner; emit only the body). Then the parties block: the Owner (name, address, PAN) of the ONE PART and the Developer (name, address, PAN) of the OTHER PART, with the usual heirs/successors/assigns inclusions.

(2) **Recitals (WHEREAS clauses)** — 3 to 4 clauses: the Owner is the absolute owner of the land (describe it: address, area, survey number); the Developer is engaged in the business of real-estate development and has approached the Owner; the parties have agreed to develop the land on the terms recorded below. End with "NOW THIS AGREEMENT WITNESSETH AS UNDER:".

(3) **Operative clauses** — numbered \`## 1.\`, \`## 2.\`, ... covering:
   1. Property / Schedule of Land — full description; refer to it as "the Schedule Property".
   2. Grant of Development Rights — the Owner grants the Developer a licence to enter and develop; make clear that possession is handed over as LICENSEE for development only and ownership does not transfer.
   3. Consideration and Sharing — the Owner's share and the Developer's share per the supplied percentage and basis (built-up area sharing or revenue sharing). Render a small GFM table of the split. Cover the refundable security deposit and any non-refundable consideration (amounts, when payable, when refundable/adjustable).
   4. Development Obligations — the Developer obtains all approvals/sanctions at its cost, constructs per sanctioned plans and RERA registration, engages architects/contractors, and bears all construction costs.
   5. Timeline — construction period in months from the possession/handover date (compute the outer date), with reasonable force-majeure allowance and any supplied grace period.
   6. Owner's Obligations — clear and marketable title, no encumbrance, execute powers of attorney limited to development/approvals, not to obstruct.
   7. Taxes — (a) capital gains: for an individual/HUF owner, Section 45(5A) of the Income-tax Act defers capital-gains tax to the year in which the completion certificate is issued — state this precisely; (b) GST on transfer of development rights and on the owner's share of constructed area per current notifications; (c) property tax till handover by the Owner, thereafter as allocated.
   8. RERA Compliance — the Developer registers the project under RERA where applicable and complies with it.
   9. Default and Remedies — consequences of the Developer's delay (liquidated damages / owner's right to terminate) and of the Owner's title defect.
   10. Dispute Resolution — arbitration under the Arbitration and Conciliation Act, 1996; courts at the property's location.
   11. Registration & Stamp Duty — this agreement (handing over possession) attracts compulsory registration under Section 17(1A) of the Registration Act, 1908.

(4) **Stamp Duty & Registration Schedule** — \`## Schedule A — Stamp Duty & Registration\`. Use Google Search to look up the CURRENT stamp duty on a joint development agreement / development-rights agreement in the property's State, and quote the rate and computed amount where possible. If you cannot determine it confidently, state "as per the prevailing rate under the <State> Stamp Act" without inventing a number.

(5) **Testimonium** — "IN WITNESS WHEREOF, the parties hereto have set their respective hands to this Agreement at <place> on the day, month and year first hereinabove written, in the presence of the witnesses subscribing hereinbelow."

DO NOT emit the signature block, witness lines, or registration block — the host renders these into the PDF. End the body after the testimonium.

FORMATTING RULES (strict)
- Output GitHub-Flavoured Markdown only — no HTML, no front-matter, no fenced code blocks.
- All rupee amounts in plain ASCII: \`Rs. 25,00,000/-\`. NEVER use the Unicode rupee character.
- Use \`**bold**\` for clause sub-headings and key amounts/dates. Numbered headings \`## 1. SCHEDULE PROPERTY\` etc.
- Statutory references must be precise: "Section 17(1A) of the Registration Act, 1908", "Section 45(5A) of the Income-tax Act, 1961".
- Never leave bracketed placeholders like [NAME] in the operative text.
- Complete every clause — never truncate mid-sentence.`;

// ── Employment-agreement system prompt ───────────────────────────────────
const EMPLOYMENT_SYSTEM_PROMPT = `You are a senior employment / labour-law counsel practising in India with 25+ years of experience drafting employment agreements for Indian companies. You are deeply familiar with the Indian Contract Act, 1872 (especially Section 27 on restraint of trade); the State Shops and Establishments Acts; the Payment of Wages Act; the EPF & MP Act, 1952; the ESI Act, 1948; the Payment of Gratuity Act, 1972; and Indian case law on the enforceability of restrictive covenants.

YOUR TASK
Draft a complete, signature-ready EMPLOYMENT AGREEMENT in GitHub-Flavoured Markdown between an employer and an employee. Use the supplied values exactly. Do not invent names, amounts, or dates. Where an optional value is absent, draft a sensible default.

DOCUMENT STRUCTURE

(1) **Preamble** — Title "EMPLOYMENT AGREEMENT" in ALL CAPS centred. Parties block: the Employer (name, registered address), "hereinafter the 'Company' / 'Employer'", of the ONE PART; and the Employee (name, address, PAN if given), of the OTHER PART.

(2) **Recitals** — 2 short WHEREAS clauses (the Company wishes to employ; the Employee has agreed to serve on the terms below). End with "NOW THIS AGREEMENT WITNESSETH AS UNDER:".

(3) **Operative clauses** — numbered \`## 1.\`, \`## 2.\`, ... covering:
   1. Appointment & Designation — role, department, reporting line, place of posting (with a reasonable transfer clause).
   2. Commencement & Probation — start date; probation period with confirmation on satisfactory completion; shorter notice during probation.
   3. Compensation — annual CTC in Rs.; render the salary structure as a GFM table if a breakdown is supplied; statutory deductions (TDS under Section 192, PF, ESI, professional tax) as applicable.
   4. Working Hours & Leave — per the supplied values; defer to the applicable State Shops and Establishments Act where silent.
   5. Duties & Standards of Conduct — diligence, compliance with policies, no conflicting engagement during employment.
   6. Confidentiality & Intellectual Property — include ONLY if the confidentiality flag is on: confidential information survives termination; work product / IP created in the course of employment vests in the Employer.
   7. Non-Solicitation — include ONLY if flagged: no solicitation of employees or clients for a stated reasonable period post-termination.
   8. Non-Compete — include ONLY if flagged. Draft it as operative DURING employment and expressly note that Indian courts, per Section 27 of the Indian Contract Act, 1872, generally do not enforce post-termination non-compete restraints; frame the post-termination restraint as limited and severable.
   9. Termination — notice period per the supplied value (or salary in lieu); summary termination for cause (misconduct, breach, conviction); return of company property.
   10. Full & Final Settlement — timelines per the applicable wage law.
   11. Governing Law & Jurisdiction — courts at the work location; reference the applicable State Shops and Establishments Act.
   12. Special Terms — render any user-supplied special terms as separately numbered sub-clauses.

(4) **Testimonium** — "IN WITNESS WHEREOF, the parties hereto have set their respective hands to this Agreement on the day, month and year first hereinabove written, in the presence of the witnesses subscribing hereinbelow."

DO NOT emit the signature block or witness lines — the host renders these. End after the testimonium.

FORMATTING RULES (strict)
- GitHub-Flavoured Markdown only; ASCII rupee amounts (\`Rs. 9,00,000/-\`); no Unicode rupee character.
- \`**bold**\` for key amounts/dates; numbered headings \`## 1. APPOINTMENT\`.
- Statutory references precise: "Section 27 of the Indian Contract Act, 1872", "Section 192 of the Income-tax Act, 1961".
- No bracketed placeholders in operative text. Complete every clause.`;

// ── Appointment-letter system prompt ─────────────────────────────────────
const APPOINTMENT_LETTER_SYSTEM_PROMPT = `You are a senior HR / employment-documentation specialist for Indian companies, expert at drafting formal appointment letters that are legally precise yet readable, consistent with the Indian Contract Act, 1872 and standard Indian HR practice.

YOUR TASK
Draft a complete, ready-to-issue APPOINTMENT LETTER in GitHub-Flavoured Markdown. This is a LETTER on the company's letterhead — not a deed. Use the supplied values exactly; do not invent names, amounts, or dates.

DOCUMENT STRUCTURE

(1) **Letter head block** — Date (today's IST date), then the candidate's name and address (as the addressee), then a subject line: "**Subject: Letter of Appointment — <Designation>**", then the salutation "Dear <Name>,".

(2) **Opening paragraph** — pleasure in appointing the candidate as <Designation> in <Department> at <place of posting>, effective from <date of joining>, reporting to <reporting designation>.

(3) **Numbered terms** — \`## 1.\`, \`## 2.\`, ... covering, in order:
   1. Position & Reporting — designation, department, reporting line, place of posting with a reasonable transfer clause.
   2. Date of Joining.
   3. Compensation — annual CTC in Rs.; if a structure is supplied render it as a small GFM table; note statutory deductions (TDS, PF, ESI, professional tax) as applicable.
   4. Probation & Confirmation — per the supplied months; confirmation in writing on satisfactory completion (omit if probation is 0).
   5. Working Hours — per the supplied value.
   6. Benefits — per the supplied benefits text; otherwise "as per company policy and applicable statutes".
   7. Leave — as per company policy and the applicable State Shops and Establishments Act.
   8. Confidentiality — brief clause: company information remains confidential during and after employment.
   9. Notice Period & Termination — per the supplied months (or salary in lieu); summary termination for misconduct.
   10. General — appointment is subject to the correctness of the information and documents furnished; company policies as amended from time to time form part of the terms.

(4) **Closing** — a paragraph asking the candidate to sign and return the duplicate copy as acceptance, then "We look forward to a long and mutually rewarding association." and "Yours sincerely,". STOP there — do NOT emit the signatory block or the acceptance endorsement; the host renders those into the PDF.

FORMATTING RULES (strict)
- GitHub-Flavoured Markdown only; ASCII rupee amounts (\`Rs. 6,00,000/-\`); no Unicode rupee character.
- Keep the tone formal but warm — this is the first document a new employee receives.
- No bracketed placeholders. Complete every numbered term.`;

// ── List user's drafts (with usage counter) ──────────────────────────────
router.get('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const rows = partnershipDeedRepo.findByUserId(req.user.id);
  const drafts = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    template_id: r.template_id,
    name: r.name,
    ui_payload: parseUiPayload(r),
    generated_content: r.generated_content,
    exported_at: r.exported_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const periodStart = getUsagePeriodStart(billingUser);
  const used = featureUsageRepo.countSinceForBillingUser(billingUser.id, 'partnership_deeds', periodStart);

  // `usage.limit` removed — there's no per-feature cap any more, only
  // the cross-feature token budget. Clients should fall back to
  // displaying just `used` (analytics counter).
  res.json({ drafts, usage: { used } });
});

// ── Create empty draft (no AI yet, no quota debit) ──────────────────────
router.post('/drafts', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

  const { template_id, name, ui_payload } = req.body ?? {};

  if (!isValidTemplateId(template_id)) {
    res.status(400).json({ error: 'template_id must be one of ' + TEMPLATE_IDS.join(', ') });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const billingUserId = billingUser.id;

  const payloadStr =
    typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload ?? {});

  const draft = partnershipDeedRepo.create(
    req.user.id,
    template_id,
    name.trim(),
    payloadStr,
    billingUserId,
  );

  res.status(201).json({
    ...draft,
    ui_payload: parseUiPayload(draft),
  });
});

// ── Get single draft ────────────────────────────────────────────────────
router.get('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ ...draft, ui_payload: parseUiPayload(draft) });
});

// ── Autosave (name and/or ui_payload) ───────────────────────────────────
router.patch('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }

  const { name, ui_payload } = req.body ?? {};
  if (typeof name === 'string' && name.trim().length > 0) {
    partnershipDeedRepo.updateName(draft.id, req.user.id, name.trim());
  }
  if (ui_payload !== undefined) {
    const payloadStr = typeof ui_payload === 'string' ? ui_payload : JSON.stringify(ui_payload);
    partnershipDeedRepo.updatePayload(draft.id, req.user.id, payloadStr);
  }
  res.json({ success: true });
});

// ── Delete ──────────────────────────────────────────────────────────────
router.delete('/drafts/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const deleted = partnershipDeedRepo.deleteById(req.params.id, req.user.id);
  if (!deleted) { res.status(404).json({ error: 'Draft not found' }); return; }
  res.json({ success: true });
});

// ── Mark exported (called after successful PDF download) ────────────────
router.post('/drafts/:id/mark-exported', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) { res.status(404).json({ error: 'Draft not found' }); return; }
  partnershipDeedRepo.markExported(draft.id, req.user.id);
  res.json({ success: true });
});

// ── Generate deed body (SSE-streamed) ───────────────────────────────────
router.post('/drafts/:id/generate', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const draft = partnershipDeedRepo.findByIdForUser(req.params.id, req.user.id);
  if (!draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }

  // Plan-limit gate — fail BEFORE opening the SSE stream so the client
  // sees a normal 429 JSON response (otherwise the stream would 200 + send
  // an error event which is harder to surface as an upgrade banner).
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const billingUserId = billingUser.id;
  // Per-feature partnership-deed cap removed in favour of the single
  // cross-feature token budget. The token gate (enforceTokenQuota) is
  // the only quota check now.

  // ── Build the user prompt ────────────────────────────────────────────
  const payload = parseUiPayload(draft) as Record<string, unknown>;
  const firm = (payload.firm ?? {}) as Record<string, unknown>;
  const partners = (payload.partners ?? []) as Array<Record<string, unknown>>;
  const banking = (payload.banking ?? {}) as Record<string, unknown>;
  const clauses = (payload.clauses ?? {}) as Record<string, unknown>;
  const remuneration = (payload.remuneration ?? {}) as Record<string, unknown>;
  const rentAgreement = (payload.rentAgreement ?? {}) as Record<string, unknown>;
  const jda = (payload.jda ?? {}) as Record<string, unknown>;
  const employment = (payload.employment ?? {}) as Record<string, unknown>;
  const appointment = (payload.appointment ?? {}) as Record<string, unknown>;
  const isRent = draft.template_id === 'rent_agreement';
  const isJda = draft.template_id === 'joint_development_agreement';
  const isEmployment = draft.template_id === 'employment_agreement';
  const isAppointment = draft.template_id === 'appointment_letter';
  // State drives stamp-duty grounding + the fileHash. Non-partnership
  // instruments carry it on their own blocks, not `firm`.
  const blockState = (b: Record<string, unknown>) => (typeof b.state === 'string' && b.state ? b.state : 'Maharashtra');
  const state = isRent ? blockState(rentAgreement)
    : isJda ? blockState(jda)
    : isEmployment ? blockState(employment)
    : isAppointment ? blockState(appointment)
    : (typeof firm.state === 'string' ? firm.state : 'Maharashtra');

  let userPrompt = '';

  if (isJda) {
    // ── Joint development agreement user prompt ─────────────────────
    userPrompt += `=== JOINT DEVELOPMENT AGREEMENT DATA (use these values exactly; do not invent or modify them) ===\n`;
    userPrompt += `Today's Date (IST): ${istDateString()}\n`;
    userPrompt += `Governing Law: ${TEMPLATE_GOVERNING_ACT[draft.template_id]}\n`;
    userPrompt += `\nJDA details:\n${JSON.stringify(jda, null, 2)}\n`;
    userPrompt += `\n=== STAMP DUTY & REGISTRATION GROUNDING INSTRUCTION ===\n`;
    userPrompt += `Use Google Search to look up the CURRENT stamp duty and registration charges payable on a joint development agreement / development-rights agreement in the State of ${state}. Cite the rate, compute the amount where possible, and reflect it in Schedule A.\n`;
    userPrompt += `\n=== YOUR TASK ===\n`;
    userPrompt += `Produce the COMPLETE joint development agreement body in GitHub-Flavoured Markdown per the structure in the system prompt. Begin with the preamble (title + parties), then recitals, then the numbered operative clauses, then Schedule A, then the testimonium. End the body after the testimonium — do NOT emit witness or signature blocks. Do NOT output bracketed placeholders in the operative text.\n`;
  } else if (isEmployment) {
    // ── Employment agreement user prompt ────────────────────────────
    userPrompt += `=== EMPLOYMENT AGREEMENT DATA (use these values exactly; do not invent or modify them) ===\n`;
    userPrompt += `Today's Date (IST): ${istDateString()}\n`;
    userPrompt += `Governing Law: ${TEMPLATE_GOVERNING_ACT[draft.template_id]}\n`;
    userPrompt += `\nEmployment details:\n${JSON.stringify(employment, null, 2)}\n`;
    userPrompt += `\n=== YOUR TASK ===\n`;
    userPrompt += `Produce the COMPLETE employment agreement body in GitHub-Flavoured Markdown per the structure in the system prompt. Include the confidentiality / non-solicitation / non-compete clauses ONLY where the corresponding flag is true. Begin with the preamble, then recitals, then the numbered operative clauses, then the testimonium. End the body after the testimonium — do NOT emit witness or signature blocks. Do NOT output bracketed placeholders in the operative text.\n`;
  } else if (isAppointment) {
    // ── Appointment letter user prompt ──────────────────────────────
    userPrompt += `=== APPOINTMENT LETTER DATA (use these values exactly; do not invent or modify them) ===\n`;
    userPrompt += `Today's Date (IST): ${istDateString()}\n`;
    userPrompt += `\nAppointment details:\n${JSON.stringify(appointment, null, 2)}\n`;
    userPrompt += `\n=== YOUR TASK ===\n`;
    userPrompt += `Produce the COMPLETE appointment letter in GitHub-Flavoured Markdown per the structure in the system prompt — letterhead block, opening paragraph, numbered terms, closing. Stop after "Yours sincerely," — do NOT emit the signatory block or acceptance endorsement. Do NOT output bracketed placeholders.\n`;
  } else if (isRent) {
    // ── Rent agreement user prompt ──────────────────────────────────
    userPrompt += `=== RENT AGREEMENT DATA (use these values exactly; do not invent or modify them) ===\n`;
    userPrompt += `Today's Date (IST): ${istDateString()}\n`;
    userPrompt += `Governing Law: ${TEMPLATE_GOVERNING_ACT[draft.template_id]}\n`;
    userPrompt += `\nRent agreement details:\n${JSON.stringify(rentAgreement, null, 2)}\n`;
    userPrompt += `\n=== STAMP DUTY & REGISTRATION GROUNDING INSTRUCTION ===\n`;
    userPrompt += `Use Google Search to look up the CURRENT stamp duty AND registration charges payable on a rent / leave-and-license agreement in the State of ${state}, for the supplied monthly rent, security deposit and lease term. Cite the rate, compute the amount, and reflect it in Schedule A. If the term is 12 months or more, note that registration under the Registration Act, 1908 is compulsory.\n`;
    userPrompt += `\n=== YOUR TASK ===\n`;
    userPrompt += `Produce the COMPLETE rent agreement body in GitHub-Flavoured Markdown per the structure in the system prompt. Begin with the preamble (title + parties), then recitals, then the numbered operative clauses, then Schedule A, then the testimonium. End the body after the testimonium — do NOT emit witness or signature blocks. Do NOT output bracketed placeholders in the operative text.\n`;
  } else {
    // ── Partnership / LLP / amendment deed user prompt ──────────────
    userPrompt += `=== DEED DATA (use these values exactly; do not invent or modify them) ===\n`;
    userPrompt += `Today's Date (IST): ${istDateString()}\n`;
    userPrompt += `Template: ${TEMPLATE_TITLES[draft.template_id]}\n`;
    userPrompt += `Governing Act: ${TEMPLATE_GOVERNING_ACT[draft.template_id]}\n`;
    userPrompt += `\nFirm:\n${JSON.stringify(firm, null, 2)}\n`;
    userPrompt += `\nPartners:\n${JSON.stringify(partners, null, 2)}\n`;
    userPrompt += `\nBanking Authority:\n${JSON.stringify(banking, null, 2)}\n`;
    userPrompt += `\nClauses:\n${JSON.stringify(clauses, null, 2)}\n`;
    // Remuneration block (Clause 9) — present for formation deeds + LLP.
    if (draft.template_id === 'partnership_deed' || draft.template_id === 'llp_agreement') {
      userPrompt += `\nRemuneration block (salary & interest on capital — drive Clause 9, stay within Section 40(b)):\n${JSON.stringify(remuneration, null, 2)}\n`;
    }

    // Reconstitution block — for both 'reconstitution_deed' (admission only)
    // and 'retirement_admission_deed' (admission half of the combined instrument).
    if (
      (draft.template_id === 'reconstitution_deed' ||
        draft.template_id === 'retirement_admission_deed') &&
      payload.reconstitution
    ) {
      userPrompt += `\nReconstitution block (incoming partner(s) & revised shares):\n${JSON.stringify(payload.reconstitution, null, 2)}\n`;
    }
    // Retirement block — for both 'retirement_deed' (exit only) and
    // 'retirement_admission_deed' (exit half of the combined instrument).
    if (
      (draft.template_id === 'retirement_deed' ||
        draft.template_id === 'retirement_admission_deed') &&
      payload.retirement
    ) {
      userPrompt += `\nRetirement block (outgoing partner & settlement):\n${JSON.stringify(payload.retirement, null, 2)}\n`;
    }
    if (draft.template_id === 'dissolution_deed' && payload.dissolution) {
      userPrompt += `\nDissolution block:\n${JSON.stringify(payload.dissolution, null, 2)}\n`;
    }
    // Extra steer for the combined deed: the LLM tends to default to
    // ONE narrative ("retirement deed" OR "admission deed"). Spell out
    // that the instrument carries both transactions on the same date(s).
    if (draft.template_id === 'retirement_admission_deed') {
      userPrompt += `\nCOMBINED-DEED INSTRUCTION:\n`;
      userPrompt += `This is a single deed effecting BOTH the retirement of the outgoing partner AND the admission of the incoming partner(s) in the SAME instrument. Title it "DEED OF RETIREMENT CUM ADMISSION". Cover both transactions in the recitals (WHEREAS the named partner wishes to retire AND the parties wish to admit new partner(s)). Include both operative clauses — "Retirement and Settlement of Outgoing Partner" and "Admission of New Partner(s)". The "Revised Profit Sharing" table must reflect the post-retirement, post-admission shares (outgoing partner removed, incoming partner(s) added, continuing partners' shares updated). Cite both Section 31 (admission) and Section 32 (retirement) of the Indian Partnership Act, 1932.\n`;
    }

    userPrompt += `\n=== STAMP DUTY GROUNDING INSTRUCTION ===\n`;
    userPrompt += `Use Google Search to look up the CURRENT stamp duty payable on a `;
    userPrompt += draft.template_id === 'llp_agreement'
      ? `Limited Liability Partnership (LLP) agreement `
      : `partnership deed `;
    userPrompt += `in the State of ${state} under the ${state} Stamp Act / the Indian Stamp Act as amended for ${state}. `;
    userPrompt += `Cite the rate, compute the amount on the supplied total capital where applicable, `;
    userPrompt += `and reflect the figure in Schedule A of the deed.\n`;

    userPrompt += `\n=== YOUR TASK ===\n`;
    userPrompt += `Produce the COMPLETE deed body in GitHub-Flavoured Markdown per the structure in `;
    userPrompt += `the system prompt. Begin with the preamble (title + parties block), then recitals, `;
    userPrompt += `then the numbered operative clauses, then Schedule A, then the testimonium. `;
    userPrompt += `End the body after the testimonium — do NOT emit witness or signature blocks.\n`;
    userPrompt += `Do NOT output bracketed placeholders in the operative text.\n`;
  }

  const sse = new SseWriter(res);
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
  let fullResponse = '';

  // Reload-resume + dedup: hash the input fingerprint (template + payload
  // + state, since stamp duty depends on state) and refuse a parallel
  // run for the same draft+fingerprint that's already 'generating'.
  // Then flip the existing draft row to status='generating' so the
  // frontend list / sidebar reflect the in-flight state and the polling
  // loop can pick up completion. Node keeps the handler running on tab
  // close; the row updates to 'generated' or 'error' regardless.
  const fileHash = crypto.createHash('sha256')
    .update(`${draft.template_id}|${state}|${draft.ui_payload}`)
    .digest('hex');
  const inProgress = partnershipDeedRepo.findInProgressByHashForUser(req.user.id, fileHash);
  if (inProgress && inProgress.id !== draft.id) {
    console.log(`[partnership-deeds] re-attaching to in-progress draft ${inProgress.id} instead of starting a new run`);
    sse.writeDone({ draftId: inProgress.id, resumed: true });
    sse.end();
    return;
  }
  partnershipDeedRepo.markGenerating(draft.id, req.user.id, fileHash);

  const callStartMs = Date.now();
  try {
    const provider = pickChatProvider();
    const usage = await provider.streamChat(
      {
        systemPrompt: isJda ? JDA_SYSTEM_PROMPT
          : isEmployment ? EMPLOYMENT_SYSTEM_PROMPT
          : isAppointment ? APPOINTMENT_LETTER_SYSTEM_PROMPT
          : isRent ? RENT_AGREEMENT_SYSTEM_PROMPT
          : PARTNERSHIP_DEED_SYSTEM_PROMPT,
        userMessage: userPrompt,
        maxTokens: MAX_TOKENS,
        onFallback: () => { sse.writeEvent({ providerFallback: true }); },
      },
      (text) => { fullResponse += text; sse.writeText(text); },
    );

    if (fullResponse) {
      // updateGeneratedContent flips status='generating' → 'generated'.
      partnershipDeedRepo.updateGeneratedContent(draft.id, req.user!.id, fullResponse);
    } else {
      partnershipDeedRepo.setError(draft.id, req.user!.id, 'Model returned an empty response');
      sse.writeError('Failed to generate partnership deed — empty model response. Please try again.');
      sse.end();
      return;
    }

    // Log TOTAL input tokens consumed (fresh + cache reads + cache writes).
    // usage.inputTokens already includes the cached portion; the cached
    // count is passed separately so it bills at the cache rate.
    const totalInput = usage.inputTokens;
    usageRepo.logWithBilling(
      clientIp,
      req.user!.id,
      billingUserId,
      totalInput,
      usage.outputTokens,
      usage.costUsd,
      false,
      usage.modelUsed,
      usage.withSearch,
      'partnership_deed',
      0,
      'success',
      0,
      Date.now() - callStartMs,
      usage.cacheReadTokens,
    );

    // Bill the monthly quota only on success.
    featureUsageRepo.logWithBilling(req.user!.id, billingUserId, 'partnership_deeds');

    sse.writeDone({ draftId: draft.id });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[partnership-deeds] Generation error: ${errMsg.slice(0, 200)}`);
    try {
      partnershipDeedRepo.setError(draft.id, req.user!.id, errMsg);
    } catch (e) {
      console.error('[partnership-deeds] failed to mark draft as error:', e);
    }
    sse.writeError('Failed to generate partnership deed. Please try again.');
  }

  sse.end();
});

export default router;
