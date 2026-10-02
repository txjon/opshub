// Match a vendor's PO reference (as printed on their invoice / UPS bill) to an
// OpsHub job. The reference's 4-digit number is the job's QB invoice number
// (jobs.type_meta.qb_invoice_number); full HPD-YYMM-NNN job numbers also appear.
// Verified on real data: 5/7 decorator refs + 83% of UPS freight rows resolved,
// client matched exactly. Shared by manual entry, the UPS CSV importer, and any
// future feeder so write/read can never disagree. See memory: opshub-cost-reconciliation.

export interface JobLite {
  id: string;
  job_number: string;
  qb_invoice_number?: string | null;
  client_id?: string | null;
  client_name?: string | null;
}

export interface PoRefIndex {
  byInvoice: Record<string, JobLite>;
  byNumber: Record<string, JobLite>;
  byCore: Record<string, JobLite>;   // "2609038" (job number minus tenant prefix)
}

// THE PO-ref key (Oct 2 2026). A job with no QB invoice uses its job number as
// the PO number, and it reaches us as "HPD-2609-038-A", "HPD-2609-038AB" (the
// PO PDF), "2609-038-AB" (the PO email subject) or "2609038A". Upper-case,
// strip punctuation, drop the leading tenant prefix: all four become one key.
// Invoice refs ("4308-A" → "4308A") never start with letters, so they pass
// through. Every bill/PO comparison keys through this — one rule.
export function poRefKey(ref: string | null | undefined): string {
  return String(ref || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[A-Z]+(?=\d)/, "");
}

// A PO ref → its number + item letters. "4313-F" → {4313,[F]};
// "4313ABCDEF" → {4313,[A..F]}; "HPD-2609-038-AB" → {2609038,[A,B]}.
export function parsePoRef(ref: string | null | undefined): { digits: string | null; letters: string[] } {
  const m = poRefKey(ref).match(/^(\d{7}|\d{3,4})([A-Z]*)$/);
  if (!m) return { digits: null, letters: [] };
  return { digits: m[1], letters: m[2] ? m[2].split("") : [] };
}

export function buildPoRefIndex(jobs: JobLite[]): PoRefIndex {
  const byInvoice: Record<string, JobLite> = {};
  const byNumber: Record<string, JobLite> = {};
  const byCore: Record<string, JobLite> = {};
  for (const j of jobs) {
    if (j.qb_invoice_number) byInvoice[String(j.qb_invoice_number).trim()] = j;
    if (j.job_number) {
      byNumber[j.job_number.toUpperCase()] = j;
      const core = j.job_number.match(/(\d{4})-(\d{3})$/);
      if (core) byCore[core[1] + core[2]] = j;
    }
  }
  return { byInvoice, byNumber, byCore };
}

// Resolve a raw PO ref ("4308-A", "HPD-2605-053A", "4299-AB") to a job, or null.
// Full job number wins over the 4-digit invoice match (more specific).
export function resolvePoRef(ref: string | null | undefined, idx: PoRefIndex): JobLite | null {
  if (!ref) return null;
  const s = String(ref).trim();
  const hpd = s.match(/HPD-\d{4}-\d{3}/i);
  if (hpd) {
    const j = idx.byNumber[hpd[0].toUpperCase()];
    if (j) return j;
  }
  // A bare job number ("2609-038-AB", the PO number of a job with no QB
  // invoice): match it BEFORE the 4-digit fallback, which would otherwise
  // read "2609" as an invoice # and could land on the wrong job.
  const core = s.match(/(?<![0-9])(\d{4})-?(\d{3})(?![0-9])/);
  if (core && idx.byCore[core[1] + core[2]]) return idx.byCore[core[1] + core[2]];
  // The invoice number is the 4-digit run (e.g. 4308 in "4308-A"). Match the
  // first standalone 4-digit group.
  const four = s.match(/(?<![0-9])(\d{4})(?![0-9])/);
  if (four && idx.byInvoice[four[1]]) return idx.byInvoice[four[1]];
  return null;
}

// The item/group suffix after the invoice/job number ("4308-A" → "A",
// "4299-AB" → "AB"). Used only as a human reference in Phase 1 (variance rolls
// up at the job×vendor level, not per suffix).
export function poRefSuffix(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = String(ref).trim().match(/(?:\d{4}|\d{3})[-\s]?([A-Za-z]{1,4})\s*$/);
  return m ? m[1].toUpperCase() : null;
}
