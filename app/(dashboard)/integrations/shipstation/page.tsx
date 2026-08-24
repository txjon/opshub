import { redirect } from "next/navigation";

// Superseded (Financial V2 1d, Aug 24 2026): the fulfillment invoice list
// lives on the AR index now. ShipStation remains on /integrations only as a
// connection card; billables were never plumbing.
export default function Moved() {
  redirect("/invoices?stream=fulfillment");
}
