import { redirect } from "next/navigation";
// Moved home (Financial V2 1d): fulfillment billables live under /invoices.
export default function Moved() { redirect("/invoices/fulfillment/new"); }
