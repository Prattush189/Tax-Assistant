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
 *   5. If ALL entries were dropped — OR the section body is empty /
 *      a placeholder like "Not applicable at this stage" — strip the
 *      entire section (heading and body) so the final letter goes
 *      straight from section 3 to section 5. Leaving an orphan
 *      heading or a "Not applicable" line looks unprofessional.
 *   6. Renumber the remaining `## N. ...` headings so they stay
 *      sequential (e.g. 5 → 4, 6 → 5) after section 4 is stripped.
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

/** Body text that means "this section has no real content". When
 *  the model emits one of these instead of obeying the prompt's
 *  "OMIT THIS ENTIRE SECTION" instruction, we strip the section
 *  ourselves so the letter doesn't carry a useless heading. */
const PLACEHOLDER_BODY_PATTERN =
  /^(?:not\s+applicable|n\.?\s*\/?\s*a|none|no\s+(?:case\s+law|precedent|citation)s?\b|nil\b|no\s+supporting\s+(?:case|precedent)s?\b)/i;

/** A single sanitised entry plus diagnostic info about why it was
 *  kept or dropped. */
export interface SanitizerReport {
  totalEntries: number;
  keptEntries: number;
  droppedEntries: number;
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

/** Renumber `## 1. FOO`, `## 2. BAR`, ... headings sequentially from 1.
 *  Used after a section is stripped so the surviving sections don't
 *  jump from "3" to "5". Only rewrites the integer; the heading text
 *  itself is preserved verbatim. */
function renumberSectionHeadings(draft: string): string {
  let counter = 0;
  return draft.replace(/^(##\s*)(\d+)(\.\s+)/gm, (_, prefix, _n, suffix) => {
    counter += 1;
    return `${prefix}${counter}${suffix}`;
  });
}

/** Remove a contiguous slice from `draft` and collapse the blank-line
 *  gap so the surrounding sections sit flush. Used when we strip the
 *  case-law section wholesale. */
function spliceSection(draft: string, start: number, end: number): string {
  const before = draft.slice(0, start).replace(/\n+$/, '');
  const after = draft.slice(end).replace(/^\n+/, '');
  return `${before}\n\n${after}`.replace(/\n{3,}/g, '\n\n');
}

export function sanitizeNoticeCitations(draft: string): SanitizerResult {
  // Always run a section-heading renumber at the end. Even if the
  // case-law section is left untouched here, the model sometimes
  // omits section 4 entirely and emits 1, 2, 3, 5, 6 — renumbering
  // fixes that for free.
  const finalize = (text: string, report: SanitizerReport): SanitizerResult => {
    const renumbered = renumberSectionHeadings(text);
    return {
      text: renumbered,
      report: { ...report, changed: report.changed || renumbered !== text },
    };
  };

  const headingMatch = SECTION_HEADING_PATTERN.exec(draft);
  if (!headingMatch) {
    return finalize(draft, {
      totalEntries: 0,
      keptEntries: 0,
      droppedEntries: 0,
      changed: false,
    });
  }

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
  const trimmedBody = sectionBody.trim();

  // Split the body into entries by Roman-numeral markers.
  const entryStarts: number[] = [];
  ENTRY_MARKER_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTRY_MARKER_PATTERN.exec(sectionBody)) !== null) {
    entryStarts.push(m.index);
  }

  // Body is empty, or it's a placeholder like "Not applicable at
  // this stage" / "N/A" / "None". The prompt instructs the model to
  // OMIT the section in this case; when it disobeys, we strip the
  // section ourselves so the final letter doesn't carry dead weight.
  if (entryStarts.length === 0) {
    const isPlaceholder = trimmedBody.length === 0
      || PLACEHOLDER_BODY_PATTERN.test(trimmedBody);
    if (isPlaceholder) {
      return finalize(spliceSection(draft, sectionStart, sectionEnd), {
        totalEntries: 0,
        keptEntries: 0,
        droppedEntries: 0,
        changed: true,
      });
    }
    // Body has real prose (e.g. a free-form paragraph the model
    // wrote without using Roman markers) — leave it alone.
    return finalize(draft, {
      totalEntries: 0,
      keptEntries: 0,
      droppedEntries: 0,
      changed: false,
    });
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

  // Nothing dropped — leave the section as the model produced it.
  if (dropped === 0) {
    return finalize(draft, {
      totalEntries: entries.length,
      keptEntries: entries.length,
      droppedEntries: 0,
      changed: false,
    });
  }

  // Every entry dropped → strip the whole section (heading included).
  // Leaving an empty heading or a hand-wave fallback line would look
  // broken and might prompt the user to fill it in with citations
  // from memory.
  if (kept.length === 0) {
    return finalize(spliceSection(draft, sectionStart, sectionEnd), {
      totalEntries: entries.length,
      keptEntries: 0,
      droppedEntries: dropped,
      changed: true,
    });
  }

  // Some entries survived — renumber them so the user doesn't see
  // (i) followed by (iii). We rewrite ONLY the leading `**(...)**`
  // marker on each kept entry; the rest of the entry text passes
  // through unchanged.
  const renumbered = kept.map((entry, idx) => {
    return entry.replace(/^\*\*\([ivxlcdmIVXLCDM]+\)\*\*/, `**(${toRoman(idx + 1)})**`);
  });

  const newSectionBody = preamble + renumbered.join('');
  const newDraft =
    draft.slice(0, afterHeading) +
    newSectionBody +
    draft.slice(sectionEnd);

  return finalize(newDraft, {
    totalEntries: entries.length,
    keptEntries: renumbered.length,
    droppedEntries: dropped,
    changed: true,
  });
}
