"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Footer from "@/components/Footer";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";

type TimelineStep = {
  key: string;
  label: string;
  reached: boolean;
  current: boolean;
  updated_at: string | null;
};

type ProductionStage = {
  key: string;
  label: string;
  status: "pending" | "in_progress" | "approved";
  approved_at: string | null;
  last_submission_at: string | null;
};

type TrackerResponse = {
  order: {
    id: string;
    quantity: number;
    status: string;
    statusLabel: string;
    createdAt: string;
    updatedAt: string;
    estimatedDeliveryDate: string | null;
  };
  product: {
    id: string;
    name: string;
    imageUrl: string;
  };
  timeline: TimelineStep[];
  progressHistory: { status: string; label: string; updated_at: string | null }[];
  productionStages: ProductionStage[] | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString();
}

function productionStatusLabel(status: ProductionStage["status"]) {
  if (status === "approved") return "Approved";
  if (status === "in_progress") return "In Progress";
  return "Pending";
}

export default function OrderProgressPage() {
  const [orderId, setOrderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TrackerResponse | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromQuery = new URLSearchParams(window.location.search).get("orderId") || "";
    if (!fromQuery) return;

    setOrderId(fromQuery.trim());
  }, []);

  const canSubmit = useMemo(() => orderId.trim().length > 0 && !loading, [orderId, loading]);

  const lookupOrder = async (idOverride?: string) => {
    const resolvedOrderId = (idOverride ?? orderId).trim();
    if (!resolvedOrderId) {
      setError("Please enter your Order ID.");
      setResult(null);
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch(`/api/orders/progress/${encodeURIComponent(resolvedOrderId)}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to find this order.");
      }

      setResult(payload as TrackerResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to find this order.";
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await lookupOrder();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#fdfdfd] via-[#f6f8fb] to-[#eef2f7]">
      <UnifiedTopNavBar />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <section className="rounded-3xl border border-gray-200 bg-white shadow-sm p-6 sm:p-10">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-[#8B1C1C]">Order Tracker</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-[#1f1f1f]">Track your order progress</h1>
            <p className="mt-4 text-gray-600 text-sm sm:text-base leading-relaxed">
              Enter your Order ID to see your current order status and production timeline. No account login is required.
            </p>
          </div>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              placeholder="Enter Order ID"
              className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#8B1C1C]/40"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-xl bg-[#8B1C1C] px-6 py-3 text-sm font-semibold text-white hover:bg-[#741717] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Checking..." : "Check Progress"}
            </button>
          </form>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {result && (
            <div className="mt-8 grid gap-4">
              <div className="rounded-2xl border border-gray-200 bg-[#fafafa] p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
                    <Image
                      src={result.product.imageUrl || "/no-image.png"}
                      alt={result.product.name || "Product"}
                      fill
                      className="object-cover"
                    />
                  </div>

                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-[#1f1f1f]">{result.product.name}</h2>
                    <p className="mt-1 text-sm text-gray-600">Order ID: {result.order.id}</p>
                    <p className="mt-1 text-sm text-gray-600">Quantity: {result.order.quantity}</p>
                  </div>

                  <div className="self-start sm:self-center rounded-full bg-[#8B1C1C]/10 px-3 py-1 text-xs font-semibold text-[#8B1C1C]">
                    {result.order.statusLabel}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <span className="text-gray-500">Created</span>
                    <div className="font-medium text-gray-900">{formatDate(result.order.createdAt)}</div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <span className="text-gray-500">Last Updated</span>
                    <div className="font-medium text-gray-900">{formatDate(result.order.updatedAt)}</div>
                  </div>
                </div>

                {result.order.estimatedDeliveryDate && (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Estimated completion: {formatDate(result.order.estimatedDeliveryDate)}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-gray-900">Progress timeline</h3>

                <ol className="mt-4 space-y-3">
                  {result.timeline.map((step) => (
                    <li key={step.key} className="flex items-start gap-3">
                      <span
                        className={`mt-1 h-3.5 w-3.5 rounded-full border ${
                          step.current
                            ? "border-[#8B1C1C] bg-[#8B1C1C]"
                            : step.reached
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-gray-300 bg-white"
                        }`}
                      />
                      <div>
                        <p className={`text-sm font-medium ${step.current ? "text-[#8B1C1C]" : "text-gray-900"}`}>{step.label}</p>
                        <p className="text-xs text-gray-500">
                          {step.updated_at ? `Updated: ${formatDate(step.updated_at)}` : "No update yet"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {result.productionStages && result.productionStages.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
                  <h3 className="text-lg font-semibold text-gray-900">Detailed production stages</h3>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {result.productionStages.map((stage) => (
                      <div key={stage.key} className="rounded-lg border border-gray-200 bg-[#fafafa] p-3">
                        <p className="text-sm font-semibold text-gray-900">{stage.label}</p>
                        <p className="mt-1 text-xs text-gray-600">Status: {productionStatusLabel(stage.status)}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {stage.approved_at
                            ? `Approved: ${formatDate(stage.approved_at)}`
                            : stage.last_submission_at
                            ? `Last activity: ${formatDate(stage.last_submission_at)}`
                            : "No activity yet"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
