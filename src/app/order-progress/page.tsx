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

          {result &&
            (() => {
              const reachedCount = result.timeline.filter((step) => step.reached).length;
              const progressPercent = Math.round((reachedCount / Math.max(1, result.timeline.length)) * 100);
              const currentStep = result.timeline.find((step) => step.current);
              const currentTimelineIndex = result.timeline.findIndex((step) => step.current);
              const inProductionTimelineIndex = result.timeline.findIndex((step) => step.key === "in_production");
              const hasMovedPastInProduction =
                inProductionTimelineIndex >= 0 && currentTimelineIndex > inProductionTimelineIndex;

              return (
                <div className="mt-8 rounded-lg border border-black/10 bg-white p-6 shadow-xl sm:p-7">
                  <div className="mb-6 flex items-center justify-between border-b pb-3">
                    <h2 className="text-xl font-bold text-black">Order Progress - {result.order.id.slice(0, 8)}...</h2>
                    <div className="rounded-full bg-[#8B1C1C]/10 px-3 py-1 text-xs font-semibold text-[#8B1C1C]">
                      {result.order.statusLabel}
                    </div>
                  </div>

                  <div className="mb-6 flex flex-col gap-3 rounded border p-3 sm:flex-row sm:items-center">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded border bg-white">
                      <Image
                        src={result.product.imageUrl || "/no-image.png"}
                        alt={result.product.name || "Product"}
                        fill
                        className="object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-black">{result.product.name || "Product"}</div>
                      <div className="text-xs text-black/70">Order ID: {result.order.id}</div>
                      <div className="text-xs text-black/70">Quantity: {result.order.quantity}</div>
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-xs text-black/70 sm:text-right">
                      <span>Created: {formatDate(result.order.createdAt)}</span>
                      <span>Updated: {formatDate(result.order.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="mb-6 rounded-xl border border-black/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-black">Production Progress</div>
                        <div className="mt-1 text-xs text-black/70">Approved stage updates are reflected here.</div>
                      </div>
                      <div className="text-sm font-semibold text-black">{progressPercent}%</div>
                    </div>
                    <div className="mt-3 h-3 w-full overflow-hidden rounded bg-gray-200">
                      <div className="h-3 bg-[#8B1C1C]" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-black/70">
                      <span>Current stage: {currentStep?.label || result.order.statusLabel}</span>
                      <span>
                        Estimated completion: {" "}
                        {result.order.estimatedDeliveryDate ? formatDate(result.order.estimatedDeliveryDate) : "Not set"}
                      </span>
                    </div>
                  </div>

                  <div className="pl-8">
                    <div className="relative space-y-6">
                      <div className="absolute bottom-0 left-3 top-0 w-px bg-gray-200" />
                      {result.timeline.map((step, index, all) => {
                        const done = step.reached;
                        const stamp =
                          step.updated_at
                            ? `${done ? "Completed" : "Updated"} - ${formatDate(step.updated_at)}`
                            : step.current
                            ? "Current stage"
                            : done
                            ? "Completed"
                            : "Pending";

                        return (
                          <div key={step.key} className="relative">
                            {index < all.length - 1 ? (
                              <div className={`absolute left-3 top-7 h-10 w-px ${done ? "bg-[#8B1C1C]" : "bg-gray-200"}`} />
                            ) : null}
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                                  done
                                    ? "border-[#8B1C1C] bg-[#8B1C1C] text-white"
                                    : "border-gray-300 bg-white text-gray-600"
                                } ${step.current ? "ring-4 ring-[#8B1C1C]/15" : ""}`}
                              >
                                {done ? "\u2713" : index + 1}
                              </div>
                              <div className="flex-1">
                                <div className="font-semibold text-black">{step.label}</div>
                                <div className="text-sm text-black/80">{stamp}</div>

                                {step.key === "in_production" && result.productionStages && result.productionStages.length > 0 ? (
                                  <div className="mt-4 rounded-xl border border-black/10 bg-gray-50 p-4">
                                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60">
                                      In Production
                                    </div>
                                    <div className="mb-3 text-xs text-black/60">Stages of how the product is constructed.</div>
                                    <div className="relative space-y-4">
                                      <div className="absolute bottom-0 left-3 top-0 w-px bg-gray-200" />
                                      {result.productionStages.map((stage: ProductionStage, stageIndex, stageList) => {
                                        const stageDone = stage.status === "approved" || hasMovedPastInProduction;
                                        const stageInProgress = !stageDone && stage.status === "in_progress";
                                        const stageStamp = stageDone
                                          ? `Completed${stage.approved_at ? ` - ${formatDate(stage.approved_at)}` : ""}`
                                          : stageInProgress
                                          ? `In Progress${
                                              stage.last_submission_at ? ` - ${formatDate(stage.last_submission_at)}` : ""
                                            }`
                                          : "Pending";

                                        return (
                                          <div key={stage.key} className="relative">
                                            {stageIndex < stageList.length - 1 ? (
                                              <div
                                                className={`absolute left-3 top-7 h-full w-px ${
                                                  stageDone ? "bg-[#8B1C1C]" : stageInProgress ? "bg-amber-300" : "bg-gray-200"
                                                }`}
                                              />
                                            ) : null}
                                            <div className="flex items-start gap-3">
                                              <div
                                                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                                                  stageDone
                                                    ? "border-[#8B1C1C] bg-[#8B1C1C] text-white"
                                                    : stageInProgress
                                                    ? "border-amber-300 bg-amber-100 text-amber-800"
                                                    : "border-gray-300 bg-white text-gray-600"
                                                }`}
                                              >
                                                {stageDone ? "\u2713" : stageIndex + 1}
                                              </div>
                                              <div className="flex-1 pb-2">
                                                <div className="font-semibold text-black">{stage.label}</div>
                                                <div className="text-sm text-black/70">{stageStamp}</div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {result.progressHistory.length > 0 ? (
                    <div className="mt-8 rounded-xl border border-black/10 p-4">
                      <div className="mb-2 text-sm font-semibold text-black">Recent Updates</div>
                      <ul className="space-y-2 text-sm text-black/80">
                        {result.progressHistory.slice(0, 4).map((entry, idx) => (
                          <li key={`${entry.status}-${entry.updated_at || idx}`} className="flex items-start justify-between gap-3">
                            <span>{entry.label}</span>
                            <span className="text-xs text-black/60">{entry.updated_at ? formatDate(entry.updated_at) : "No timestamp"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })()}
        </section>
      </main>

      <Footer />
    </div>
  );
}
