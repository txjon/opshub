// Standing production notes: printed on EVERY PO, for every vendor, above the
// item's own production notes (PO PDF + vendor portal order page). One list,
// not copied into items.production_notes_po, so it applies to every PO and
// every re-send and can't be deleted off a single item by accident.
//
// Photo proof (Jon, Sep 18 2026): after HPD-2608-042 was printed from the wrong
// art, every printer sends a photo of the first printed piece before the run.
// Vendor-facing copy: no em-dashes.
export const PO_STANDING_PRODUCTION_NOTES: string[] = [
  "Photo proof required. Email a photo of the first printed piece before running the full order.",
];
