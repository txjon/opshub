/**
 * Invoice number is the real job number once it exists.
 * HPD-YYMM-NNN (job_number) is just the quote number.
 *
 * Use displayNumber() for anything customer/vendor-facing post-quote.
 * Use job_number directly only for quote-phase documents.
 */

type JobLike = {
  job_number?: string | null;
  type_meta?: { qb_invoice_number?: string | null } | null;
};

/** Returns invoice number if it exists, otherwise job_number */
export function displayNumber(job: JobLike): string {
  return job.type_meta?.qb_invoice_number || job.job_number || "";
}

/** Returns true if an invoice number has been created */
export function hasInvoiceNumber(job: JobLike): boolean {
  return !!job.type_meta?.qb_invoice_number;
}

/** Returns the invoice number or null */
export function invoiceNumber(job: JobLike): string | null {
  return job.type_meta?.qb_invoice_number || null;
}

/** Returns the quote number (always HPD-YYMM-NNN) */
export function quoteNumber(job: JobLike): string {
  return job.job_number || "";
}
