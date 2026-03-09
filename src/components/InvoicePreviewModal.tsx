"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type InvoicePreviewModalProps = {
  userItemId: string | null;
  onClose: () => void;
};

export default function InvoicePreviewModal({ userItemId, onClose }: InvoicePreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [html, setHtml] = useState("");

  useEffect(() => {
    if (!userItemId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setInvoiceNumber("");
        setHtml("");

        const { data: sessionWrap } = await supabase.auth.getSession();
        const token = sessionWrap?.session?.access_token;
        if (!token) {
          throw new Error("Please log in again to view your invoice.");
        }

        const res = await fetch(`/api/invoices/${encodeURIComponent(userItemId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json?.error || "Failed to load invoice.");
        }

        if (cancelled) return;
        setInvoiceNumber(json?.invoice?.invoice_number || "");
        setHtml(json?.invoice?.invoice_html || "");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userItemId]);

  if (!userItemId) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <div className="text-lg font-bold text-black">{invoiceNumber ? `Invoice ${invoiceNumber}` : "Invoice Preview"}</div>
            <div className="text-xs text-black/60">Order ID: {userItemId}</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/profile/invoice/${userItemId}`}
              className="rounded border border-black/20 bg-white px-3 py-2 text-sm text-black hover:bg-gray-100"
            >
              Open Full Page
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-black/90"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 bg-gray-50">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-black/70">Loading invoice…</div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="text-lg font-semibold text-black">Invoice unavailable</div>
              <div className="text-sm text-black/70">{error}</div>
            </div>
          ) : (
            <iframe title="Invoice Preview" srcDoc={html} className="h-full w-full bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
