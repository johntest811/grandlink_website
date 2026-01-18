"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

export default function InvoicePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userItemId = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        if (!userItemId) {
          setError("Missing invoice id");
          return;
        }

        const { data: sessionWrap } = await supabase.auth.getSession();
        const token = sessionWrap?.session?.access_token;
        if (!token) {
          router.push("/login");
          return;
        }

        const res = await fetch(`/api/invoices/${encodeURIComponent(userItemId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load invoice");

        const inv = json?.invoice;
        setInvoiceNumber(inv?.invoice_number || "");
        setHtml(inv?.invoice_html || "");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [userItemId, router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-black">Loading invoice…</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="text-xl font-bold text-black">Invoice unavailable</div>
        <div className="mt-2 text-sm text-black/70">{error}</div>
        <button
          className="mt-6 rounded bg-black px-4 py-2 text-white"
          onClick={() => router.back()}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-black">Invoice {invoiceNumber || ""}</div>
            <div className="text-xs text-black/60">Order ID: {userItemId}</div>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded border border-black/20 bg-white px-3 py-2 text-sm text-black hover:bg-gray-100"
              onClick={() => router.back()}
            >
              Back
            </button>
            <button
              className="rounded bg-[#8B1C1C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#701313]"
              onClick={() => window.print()}
            >
              Print
            </button>
          </div>
        </div>

        {/* Render the invoice in an iframe for clean printing */}
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <iframe
            title="Invoice"
            srcDoc={html}
            className="w-full"
            style={{ height: "80vh" }}
          />
        </div>
      </div>
    </div>
  );
}
