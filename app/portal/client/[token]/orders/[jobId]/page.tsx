"use client";
// Thin page wrapper — the reusable view lives in ./OrderDetailView (a page
// file may only export Next-recognized symbols).
import { OrderDetailView } from "./OrderDetailView";

export default function ClientHubOrderDetail({ params }: { params: { token: string; jobId: string } }) {
  return <OrderDetailView token={params.token} jobId={params.jobId} />;
}
