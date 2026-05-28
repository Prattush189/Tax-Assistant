/**
 * Post-flight citation sanitizer for notice drafts.
 *
 * The notice generator prompts the model for case-law citations with
 * mandatory source URLs (verified through Gemini search grounding).
 * The model occasionally still produces citation entries WITHOUT a
 * URL — either because it ran out of search-grounded results and
 * confabulated, or because it dropped the URL while formatting.
 * Either case is dangerous: a fabricated `Acme v. CIT, (148) Guj 2023`
 * looks legitimate enough to slip through a busy CA's review and
 * land in a real reply to the tax department, where it gets caught
 * and damages credibility.
 *
 * Strategy:
 *   1. Locate the `## 4. SUPPORTING CASE LAWS` section by its
 *      heading. (We also accept variants — different capitalisations,
 *      "PRECEDENTS" suffix, etc.)
 *   2. Split into numbered entries by the `**(i)**` / `**(ii)**`
 *      Roman-numeral markers the prompt instructs the model to use.
 *   3. For each entry, look for a URL on a known authoritative host
 *      (indiankanoon, itat.gov.in, sci.gov.in, livelaw.in, taxmann,
 *      taxsutra, cleartax.in/lawnetwork, *.nic.in, *.gov.in).
 *   4. Drop entries without such a URL. Renumber the survivors.
 *   5. If ALL entries were dropped, replace the section body with a
 *      one-sentence fallback so the section heading isn't left
 *      orphaned.
 *
 * The sanitizer is deliberately conservative — it only modifies the
 * case-law section. Inline references in section 5 (`(see CBDT
 * Circular No. 12/2024)`) are left untouched because CBDT/CBIC
 * circulars are easier for the model to cite accurately and
 * hallucination there is rare in practice.
 */

/** Hosts we trust as evidence that the citation is real. Anything
 *  outside this allowlist (random commentary blogs, dead links,
 *  example.com placeholders) is treated as "no URL". */
const AUTHORITATIVE_HOST_PATTERN =
  /https?:\/\/(?:[a-z0-9-]+\.)*(indiankanoon\.org|itat\.gov\.in|sci\.gov\.in|livelaw\.in|barandbench\.com|taxmann\.com|taxsutra\.com|cleartax\.in|incometax\.gov\.in|incometaxindia\.gov\.in|cbic\.gov\.in|cbic-gst\.gov\.in|gst\.gov\.in|mca\.gov\.in|sebi\.gov\.in|rbi\.org\.in|gov\.in|nic\.in)\b[^\s)\]]*/i;

/** Section heading we operate on. Matched loosely — the model
 *  sometimes drops the "/ LEGAL PRECEDENTS" suffix or uses lower
 *  case. We also accept variants where the number is different. */
const SECTION_HEADING_PATTERN =
  /^##\s*\d+\.\s*SUPPORTING\s+CASE\s+LAWS(?:\s*\/\s*LEGAL\s+PRECEDENTS)?\s*$/im;

/** Roman-numeral marker `**(i)** ...`, `**(ii)** ...`, etc. Used to
 *  split the section into entries. We accept upper / lower case and
 *  with or without the trailing colon-and-space after the close
 *  paren. */
const ENTRY_MARKER_PATTERN = /\*\*\(([ivxlcdmIVXLCDM]+)\)\*\*/g;

/** A single sanitised entry plus diagnostic info about why it was
 *  kept or dropped. */
export interface SanitizerReport {
  totalEntries: number;
  keptEntries: number;
  droppedEntries: number;
  /** Statutory blockquotes attributed to a Section but lacking an
   *  authoritative source URL nearby. These get replaced with a
   *  visible warning so the user double-checks against the bare Act
   *  before relying on the quoted text. */
  unverifiedQuotations: number;
  /** True when the post-flight pass meaningfully changed the draft. */
  changed: boolean;
}

export interface SanitizerResult {
  text: string;
  report: SanitizerReport;
}

/** Convert 1-based index to lowercase Roman numeral up to 20.
 *  Section 6 caps at "0–4" entries in the prompt so 20 is generous. */
function toRoman(n: number): string {
  const romans = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
                  'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
  return romans[n] ?? `n${n}`;
}

/**
 * Replace blockquoted statutory text that lacks an authoritative
 * source URL on a nearby `Source:` line with a visible verification
 * warning. The model is instructed (in the prompt) to either attach
 * a Source URL or paraphrase in prose; this is the automated guard
 * for the cases where it doesn't. Returns the modified draft and the
 * count of warnings inserted.
 *
 * Matches a blockquote that opens with `> "Section <N>...:` or
 * `> "<Title>: Section <N>...` — i.e. attributed-to-a-section quotes,
 * which are the high-risk hallucination case. Pure prose blockquotes
 * (e.g. quoting the department's own intimation text) are not
 * touched.
 */
function annotateUnverifiedStatutoryQuotations(draft: string): { text: string; warnings: number } {
  // Identify each `> "..."` blockquote block. A block is one or more
  // consecutive lines starting with `> `. We scan greedily, then for
  // each block test whether (a) its content looks like a statutory
  // quotation and (b) there's an authoritative-host URL within ~250
  // characters AFTER the block (typically on a `Source: ...` line).
  const blockPattern = /(^|\n)(>\s.+(?:\n>\s.+)*)/g;
  // Heuristic for "this blockquote is quoting a statute": the first
  // few words are some form of `Section X(Y)`, or `Rule X`, or
  // `Article X`, or a bare `"Section X..."` opener. Quotes of the
  // department's intimation text typically start with words like
  // "Total tax liability", "We have processed", or directly with
  // assessee data — those don't trip this pattern.
  const STATUTORY_OPENER = /\b(?:section|rule|article|clause)\s*\d+/i;
  let warnings = 0;
  const out = draft.replace(blockPattern, (full, leading, block: string) => {
    const content = block.replace(/^>\s?/gm, '').trim();
    if (!STATUTORY_OPENER.test(content.slice(0, 80))) return full;
    // Look in the surrounding context (the 250 chars after the block
    // in the ORIGINAL draft) for an authoritative URL. We have to
    // search the post-block window of the source text, but `replace`
    // doesn't give us the absolute offset cheaply. Use indexOf:
    const blockIdxInDraft = draft.indexOf(block);
    const window = blockIdxInDraft >= 0
      ? draft.slice(blockIdxInDraft + block.length, blockIdxInDraft + block.length + 350)
      : '';
    if (AUTHORITATIVE_HOST_PATTERN.test(window)) return full;
    warnings++;
    // Insert the warning AFTER the blockquote, leaving the original
    // text intact so the user sees what the AI produced AND knows it
    // isn't verified. Deleting outright would lose information the
    // user might still find useful; flagging gives them context.
    return `${leading}${block}\n>\n> ⚠️ **AI quotation — not verified against the bare Act.** Confirm this text against the official statute (incometaxindia.gov.in / cbic.gov.in) before relying on it.`;
  });
  return { text: out, warnings };
}

export function sanitizeNoticeCitations(draft: string): SanitizerResult {
  // First pass: statutory-quotation warnings. This is independent of
  // the case-law section and runs unconditionally.
  const quoted = annotateUnverifiedStatutoryQuotations(draft);
  const annotatedDraft = quoted.text;
  const unverifiedQuotations = quoted.warnings;

  const headingMatch = SECTION_HEADING_PATTERN.exec(annotatedDraft);
  if (!headingMatch) {
    return {
      text: annotatedDraft,
      report: {
        totalEntries: 0,
        keptEntries: 0,
        droppedEntries: 0,
        unverifiedQuotations,
        changed: unverifiedQuotations > 0,
      },
    };
  }
  // Re-bind draft to the annotated version so the rest of the
  // function operates on the post-quotation-pass text.
  draft = annotatedDraft;

  // Slice the document into pre-section / section / post-section.
  // The section ends at the next `## ` heading or end-of-string.
  const sectionStart = headingMatch.index;
  const afterHeading = sectionStart + headingMatch[0].length;
  const restOfDoc = draft.slice(afterHeading);
  const nextHeadingMatch = /\n##\s/.exec(restOfDoc);
  const sectionEnd = nextHeadingMatch
    ? afterHeading + nextHeadingMatch.index
    : draft.length;

  const sectionBody = draft.slice(afterHeading, sectionEnd);

  // Split the body into entries. We collect text BEFORE the first
  // marker as `preamble` (usually empty, just whitespace, or an
  // intro line we keep verbatim). Each subsequent chunk is one
  // numbered entry.
  const entryStarts: number[] = [];
  ENTRY_MARKER_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTRY_MARKER_PATTERN.exec(sectionBody)) !== null) {
    entryStarts.push(m.index);
  }

  if (entryStarts.length === 0) {
    // No structured entries — leave the section alone. Could be the
    // model omitted the section content but left the heading; the
    // sanitizer doesn't need to fight that here.
    return {
      text: draft,
      report: {
        totalEntries: 0,
        keptEntries: 0,
        droppedEntries: 0,
        unverifiedQuotations,
        changed: unverifiedQuotations > 0,
      },
    };
  }

  const preamble = sectionBody.slice(0, entryStarts[0]);
  const entries: string[] = [];
  for (let i = 0; i < entryStarts.length; i++) {
    const start = entryStarts[i];
    const end = i + 1 < entryStarts.length ? entryStarts[i + 1] : sectionBody.length;
    entries.push(sectionBody.slice(start, end));
  }

  // Keep entries that contain at least one URL from an authoritative
  // host. The host check has to happen against the WHOLE entry chunk
  // (the URL may sit in the citation line, the principle paragraph,
  // or a trailing parenthetical), so we test the chunk as a string.
  const kept: string[] = [];
  let dropped = 0;
  for (const entry of entries) {
    if (AUTHORITATIVE_HOST_PATTERN.test(entry)) {
      kept.push(entry);
    } else {
      dropped++;
    }
  }

  // Nothing changed in the case-law section → return early; we may
  // still have inserted quotation warnings above, so the `changed`
  // flag is gated on either signal.
  if (dropped === 0) {
    return {
      text: draft,
      report: {
        totalEntries: entries.length,
        keptEntries: entries.length,
        droppedEntries: 0,
        unverifiedQuotations,
        changed: unverifiedQuotations > 0,
      },
    };
  }

  // Renumber survivors so the user doesn't see (i) followed by (iii).
  // We rewrite ONLY the leading `**(...)**` marker on each kept
  // entry; the rest of the entry text passes through unchanged.
  const renumbered = kept.map((entry, idx) => {
    return entry.replace(/^\*\*\([ivxlcdmIVXLCDM]+\)\*\*/, `**(${toRoman(idx + 1)})**`);
  });

  // If every entry was dropped, replace the section body with a
  // one-sentence fallback. Leaving an empty heading would look broken
  // and might prompt the user to fill it in with their own (possibly
  // wrong) citations from memory.
  const newSectionBody = renumbered.length === 0
    ? '\n\nThe legal submissions above are grounded in the statutory provisions cited; no judicial precedent is relied upon in this reply.\n\n'
    : preamble + renumbered.join('');

  const newDraft =
    draft.slice(0, afterHeading) +
    newSectionBody +
    draft.slice(sectionEnd);

  return {
    text: newDraft,
    report: {
      totalEntries: entries.length,
      keptEntries: renumbered.length,
      droppedEntries: dropped,
      unverifiedQuotations,
      changed: true,
    },
  };
}
