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
}

export function buildPoRefIndex(jobs: JobLite[]): PoRefIndex {
  const byInvoice: Record<string, JobLite> = {};
  const byNumber: Record<string, JobLite> = {};
  for (const j of jobs) {
    if (j.qb_invoice_number) byInvoice[String(j.qb_invoice_number).trim()] = j;
    if (j.job_number) byNumber[j.job_number.toUpperCase()] = j;
  }
  return { byInvoice, byNumber };
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
