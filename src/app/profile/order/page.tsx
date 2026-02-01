"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type UserItem = {
  id: string;
  user_id: string;
  product_id: string;
  item_type: string;
  status: string;
  order_status: string;
  order_progress?: string;
  quantity: number;
  meta: any;
  created_at: string;
  updated_at?: string;
  admin_accepted_at?: string;
  delivery_address_id?: string | null;
  progress_history?: any[];
  total_paid?: number;
  total_amount?: number;
  payment_method?: string;
};

type Product = {
  id: string;
  name?: string;
  price?: number;
  images?: string[];
  image1?: string;
  image2?: string;
};

type PaymentSession = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_provider?: string;
  created_at: string;
  completed_at?: string;
  paypal_order_id?: string;
  stripe_session_id?: string;
};

type Address = {
  id: string;
  full_name: string;
  address: string;
  phone?: string;
  is_default?: boolean;
};

const BRANCHES = [
  "BALINTAWAK BRANCH",
  "STA. ROSA BRANCH",
  "UGONG BRANCH",
  "ALABANG SHOWROOM",
  "IMUS BRANCH",
  "PAMPANGA SHOWROOM",
  "HIHOME BRANCH",
  "MC HOME DEPO ORTIGAS",
  "SAN JUAN CITY",
  "CW COMMONWEALTH",
  "MC HOME DEPO BGC",
];

function canChangeOrder(it: UserItem) {
  const s = String(it.order_status || it.order_progress || it.status || "");
  return s === "approved" || s === "accepted" || s === "pending_acceptance" || s === "pending_payment";
}

export default function ProfileOrderPage() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserItem[]>([]);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<{ item: UserItem; product: Product } | null>(null);
  const [receiptSessions, setReceiptSessions] = useState<PaymentSession[]>([]);
  const [progressModal, setProgressModal] = useState<{ item: UserItem; product?: Product } | null>(null);

  const [changeModal, setChangeModal] = useState<{ item: UserItem; product?: Product } | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [changeMethod, setChangeMethod] = useState<"delivery" | "pickup">("delivery");
  const [changeAddressId, setChangeAddressId] = useState<string>("");
  const [changeBranch, setChangeBranch] = useState<string>("");
  const [changing, setChanging] = useState(false);

  // Load orders + related products
  const load = async (uid: string) => {
    try {
      setLoading(true);

      const stages = [
        "approved",
        "accepted",
        "in_production",
        "quality_check",
        "packaging",
        "ready_for_delivery",
        "out_for_delivery",
      ];
      const { data: uiData, error: uiErr } = await supabase
        .from("user_items")
        .select("*")
        .eq("user_id", uid)
        .or(`item_type.eq.order,order_status.in.(${stages.join(",")})`)
        .not("status", "in", `(cancelled,completed)`)
        .order("created_at", { ascending: false });

      if (uiErr) throw uiErr;

      const userItems = (uiData ?? []) as UserItem[];
      setItems(userItems);

      const productIds = Array.from(new Set(userItems.map((u) => u.product_id).filter(Boolean)));
      if (productIds.length) {
        const { data: prodData, error: prodErr } = await supabase
          .from("products")
          .select("id, name, price, images, image1, image2")
          .in("id", productIds);

        if (prodErr) throw prodErr;

        const map: Record<string, Product> = {};
        (prodData ?? []).forEach((p) => (map[p.id] = p as Product));
        setProductsById(map);
      } else {
        setProductsById({});
      }
    } catch (e) {
      console.error("load orders error", e);
    } finally {
      setLoading(false);
    }
  };

  // Get user id, then initial load
  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = (userData as any)?.user?.id ?? null;
      if (!uid) {
        setLoading(false);
        return;
      }
      setUserId(uid);
      await load(uid);
    })();
  }, []);

  // Realtime: refresh on any updates for this user
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("user_orders_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_items", filter: `user_id=eq.${userId}` },
        () => load(userId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const p = productsById[it.product_id];
      const title = (p?.name ?? "").toLowerCase();
      return title.includes(q) || it.id.toLowerCase().includes(q);
    });
  }, [items, productsById, query]);

  // Helpers to read timeline data
  const getHistory = (it: UserItem) =>
    (Array.isArray((it as any).progress_history) && (it as any).progress_history) ||
    (Array.isArray(it.meta?.progress_history) && it.meta?.progress_history) ||
    [];

  const findTime = (it: UserItem, statuses: string[]) => {
    const hist = getHistory(it);
    const match = hist.find((h: any) => statuses.includes(h.status));
    return match?.updated_at ? new Date(match.updated_at) : undefined;
  };

  const stageLabel = (k: string) =>
    ({
      approved: "Approved",
      in_production: "In Production",
      quality_check: "Quality Check",
      packaging: "Packaging",
      start_packaging: "Packaging",
      ready_for_delivery: "Ready for Delivery",
      out_for_delivery: "Out for Delivery",
      completed: "Delivered",
    }[k] || k.replace(/_/g, " "));

  const steps = ["approved", "in_production", "quality_check", "packaging", "ready_for_delivery", "out_for_delivery", "completed"];

  const reachedIndex = (it: UserItem) => {
    const cur = it.order_status || it.order_progress || it.status || "approved";
    const normalize = (s: string) => (s === "start_packaging" ? "packaging" : s);
    const idx = steps.indexOf(normalize(cur));
    return idx < 0 ? 0 : idx;
  };

  const openReceipt = async (item: UserItem) => {
    const product = productsById[item.product_id];
    setSelectedOrder({ item, product });
    // fetch sessions for this item
    const { data, error } = await supabase
      .from("payment_sessions")
      .select(
        "id,amount,currency,status,payment_provider,created_at,completed_at,paypal_order_id,stripe_session_id"
      )
      .eq("user_item_id", item.id)
      .order("created_at", { ascending: false });
    if (!error) setReceiptSessions((data || []) as PaymentSession[]);
  };

  const openProgress = (item: UserItem) => {
    const product = productsById[item.product_id];
    setProgressModal({ item, product });
  };

  const requestCancellation = async (item: UserItem) => {
    if (!userId) return;
    const reason = window.prompt("Reason for cancellation (optional):", "") ?? "";
    if (!confirm("Request cancellation for this order?")) return;

    try {
      const prevStage = item.order_status || item.order_progress || item.status || "approved";
      const { error } = await supabase
        .from("user_items")
        .update({
          order_status: "pending_cancellation",
          status: "pending_cancellation",
          meta: {
            ...(item.meta || {}),
            cancel_requested: true,
            cancel_requested_at: new Date().toISOString(),
            cancel_reason: reason.trim() || null,
            cancel_prev_stage: prevStage,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      if (error) throw error;

      alert("Cancellation request submitted. Awaiting admin approval.");
      // Keep it visible (it will show as Pending Cancellation on refresh/realtime)
    } catch (error: any) {
      alert("Failed to request cancellation: " + error.message);
    }
  };

  const openChange = async (item: UserItem) => {
    const product = productsById[item.product_id];
    setChangeModal({ item, product });

    const inferred: "delivery" | "pickup" =
      item?.meta?.delivery_method === "pickup" || item?.meta?.fulfillment_method === "pickup"
        ? "pickup"
        : item?.delivery_address_id
        ? "delivery"
        : "pickup";

    setChangeMethod(inferred);
    setChangeAddressId(item?.delivery_address_id || "");
    setChangeBranch(String(item?.meta?.selected_branch || item?.meta?.branch || ""));

    const { data: userData } = await supabase.auth.getUser();
    const uid = (userData as any)?.user?.id ?? null;
    if (!uid) return;

    const { data } = await supabase
      .from("addresses")
      .select("id,full_name,address,phone,is_default")
      .eq("user_id", uid)
      .order("is_default", { ascending: false });

    setAddresses((data || []) as Address[]);
  };

  const saveChange = async () => {
    if (!changeModal) return;
    if (changeMethod === "delivery" && !changeAddressId) {
      alert("Please select a delivery address");
      return;
    }
    if (changeMethod === "pickup" && !changeBranch) {
      alert("Please select a pickup branch");
      return;
    }

    setChanging(true);
    try {
      const { data: sessionWrap } = await supabase.auth.getSession();
      const token = sessionWrap?.session?.access_token;
      if (!token) {
        alert("Please login again");
        return;
      }

      const res = await fetch("/api/orders/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_item_id: changeModal.item.id,
          delivery_method: changeMethod,
          delivery_address_id: changeMethod === "delivery" ? changeAddressId : null,
          branch: changeMethod === "pickup" ? changeBranch : null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update order");

      alert("Order updated successfully.");
      setChangeModal(null);
      if (userId) await load(userId);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setChanging(false);
    }
  };

  const currency = (n?: number) => `₱${(n ?? 0).toLocaleString()}`;

  if (loading) return <div className="py-16 text-center text-black">Loading...</div>;

  return (
    <section className="flex-1 flex flex-col px-8 py-8">
      {/* Search */}
      <div className="mb-2">
        <input
          type="text"
          placeholder="Search active orders"
          className="w-full border rounded px-4 py-2 bg-white text-black placeholder:text-black/50"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <hr className="mb-4 border-black/10" />

      {/* List */}
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center border rounded bg-white py-16">
          <div className="flex flex-col items-center">
            {/* <Image src="/no-orders.png" alt="No Orders" width={80} height={80} /> */}
            <p className="mt-4 text-black text-lg font-medium">No active orders yet</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((item) => {
            const product = productsById[item.product_id];
            const imgUrl = product?.images?.[0] || product?.image1 || "/no-image.png";
            
            // Use total_amount if available (includes all fees and discounts), fallback to total_paid, then calculate
            const totalPrice = item.total_amount 
              ? Number(item.total_amount)
              : item.total_paid 
              ? Number(item.total_paid)
              : (product?.price || 0) * item.quantity;

            return (
              <div key={item.id} className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow">
                <div className="flex gap-4">
                  <Image
                    src={imgUrl}
                    alt={product?.name || "Product image"}
                    width={96}
                    height={96}
                    className="w-24 h-24 object-cover rounded"
                  />

                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-2 text-black">{product?.name}</h3>
                    <p className="text-sm text-black">Quantity: {item.quantity}</p>
                    <p className="text-lg font-semibold text-black mt-2">Total Paid: ₱{(totalPrice).toLocaleString()}</p>
                    {item.payment_method && (
                      <p className="text-xs text-black mt-1">via {item.payment_method.toUpperCase()}</p>
                    )}

                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => openReceipt(item)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        View Receipt
                      </button>
                      <Link
                        href={`/profile/invoice/${item.id}`}
                        className="px-4 py-2 bg-[#8B1C1C] text-white rounded hover:bg-[#701313] text-sm inline-flex items-center"
                      >
                        View Invoice
                      </Link>
                      {canChangeOrder(item) && (
                        <button
                          onClick={() => openChange(item)}
                          className="px-4 py-2 border border-black text-black rounded hover:bg-gray-50 text-sm"
                        >
                          Change
                        </button>
                      )}
                      <button
                        onClick={() => openProgress(item)}
                        className="px-4 py-2 bg-black text-white rounded hover:bg-black/90 text-sm"
                      >
                        View Progress
                      </button>
                      {String(item.order_status || item.status || item.order_progress || "") !== "completed" &&
                        String(item.order_status || item.status || item.order_progress || "") !== "cancelled" && (
                        <button
                          onClick={() => requestCancellation(item)}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                        >
                          Request Cancel
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-black mt-2">
                      Accepted: {item.admin_accepted_at ? new Date(item.admin_accepted_at).toLocaleString() : "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Change Order Modal */}
      {changeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-black">Change Order</div>
                <div className="text-xs text-black/60">Order ID: {changeModal.item.id}</div>
              </div>
              <button
                className="rounded border px-2 py-1 text-sm"
                onClick={() => setChangeModal(null)}
                disabled={changing}
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-sm font-medium text-black">Fulfillment Method</div>
                <div className="mt-2 flex gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-black">
                    <input
                      type="radio"
                      name="changeMethod"
                      value="delivery"
                      checked={changeMethod === "delivery"}
                      onChange={() => setChangeMethod("delivery")}
                      disabled={changing}
                    />
                    Delivery
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-black">
                    <input
                      type="radio"
                      name="changeMethod"
                      value="pickup"
                      checked={changeMethod === "pickup"}
                      onChange={() => setChangeMethod("pickup")}
                      disabled={changing}
                    />
                    Pickup
                  </label>
                </div>
              </div>

              {changeMethod === "delivery" ? (
                <div>
                  <div className="text-sm font-medium text-black">Delivery Address</div>
                  <select
                    className="mt-1 w-full border rounded px-3 py-2 text-black"
                    value={changeAddressId}
                    onChange={(e) => setChangeAddressId(e.target.value)}
                    disabled={changing}
                  >
                    <option value="">Select Address</option>
                    {addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name} — {a.address}
                      </option>
                    ))}
                  </select>
                  {addresses.length === 0 && (
                    <div className="mt-1 text-xs text-black/60">No saved addresses found.</div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-sm font-medium text-black">Pickup Branch</div>
                  <select
                    className="mt-1 w-full border rounded px-3 py-2 text-black"
                    value={changeBranch}
                    onChange={(e) => setChangeBranch(e.target.value)}
                    disabled={changing}
                  >
                    <option value="">Select Store Branch</option>
                    {BRANCHES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2 text-sm text-black"
                onClick={() => setChangeModal(null)}
                disabled={changing}
              >
                Cancel
              </button>
              <button
                className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={saveChange}
                disabled={changing}
              >
                {changing ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Modal - NEW vertical aligned stepper */}
      {progressModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6">
            <div className="flex items-center justify-between border-b pb-3 mb-6">
              <h2 className="text-xl font-bold text-black">
                Order Progress • {progressModal.item.id.slice(0, 8)}…
              </h2>
              <button onClick={() => setProgressModal(null)} className="text-black text-xl" aria-label="Close">×</button>
            </div>

            {(() => {
              const raw = Number(progressModal.item?.meta?.production_percent ?? 0);
              const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
              const updates = Array.isArray(progressModal.item?.meta?.production_updates)
                ? (progressModal.item.meta.production_updates as any[])
                : [];
              const finalQc = progressModal.item?.meta?.final_qc;
              const isInQualityCheck =
                String(progressModal.item?.order_status || progressModal.item?.order_progress || progressModal.item?.status || "") ===
                "quality_check";

              return (
                <>
                  {/* Production progress bar */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-black">Production Progress</div>
                      <div className="text-sm font-semibold text-black">{pct}%</div>
                    </div>
                    <div className="mt-2 h-3 w-full rounded bg-gray-200 overflow-hidden">
                      <div className="h-3 bg-[#8B1C1C]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-black/70">Only team-leader approved updates appear here.</div>
                  </div>

                  {/* Approved updates */}
                  <div className="mb-8">
                    <div className="text-sm font-semibold text-black mb-2">Production Updates</div>
                    {updates.length === 0 ? (
                      <div className="text-sm text-black/70">No approved updates yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {updates
                          .slice()
                          .sort((a, b) => String(b.approved_at || "").localeCompare(String(a.approved_at || "")))
                          .map((u, idx) => {
                            const imgs = Array.isArray(u.image_urls) ? u.image_urls : [];
                            return (
                              <div
                                key={String(u.task_update_id || u.id || u.approved_at || idx)}
                                className="border rounded-lg p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="text-xs text-black/70">
                                    {u.is_final_qc ? "FINAL QC" : "UPDATE"}
                                    {u.submitted_by_name ? ` • by ${u.submitted_by_name}` : ""}
                                  </div>
                                  <div className="text-xs text-black/60">
                                    {u.approved_at ? new Date(u.approved_at).toLocaleString() : ""}
                                  </div>
                                </div>
                                {u.description && (
                                  <div className="mt-2 text-sm text-black whitespace-pre-wrap">{u.description}</div>
                                )}
                                {imgs.length > 0 && (
                                  <div className="mt-2 grid grid-cols-3 gap-2">
                                    {imgs.map((url: string, idx: number) => (
                                      <img key={idx} src={url} alt="" className="h-24 w-full object-cover rounded border" />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>

                  {/* Final QC snapshot (optional) */}
                  {finalQc && (finalQc.description || (Array.isArray(finalQc.image_urls) && finalQc.image_urls.length)) ? (
                    <div className="mb-8">
                      <div className="text-sm font-semibold text-black mb-2">Quality Check</div>
                      {finalQc.description && (
                        <div className="text-sm text-black whitespace-pre-wrap">{finalQc.description}</div>
                      )}
                      {Array.isArray(finalQc.image_urls) && finalQc.image_urls.length > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {finalQc.image_urls.map((url: string, idx: number) => (
                            <img key={idx} src={url} alt="" className="h-24 w-full object-cover rounded border" />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : isInQualityCheck ? (
                    <div className="mb-8 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                      Quality Check has started, but the final QC photo/description has not been published yet.
                    </div>
                  ) : null}
                </>
              );
            })()}

            {(() => {
              const doneIdx = reachedIndex(progressModal.item);
              return (
                <div className="pl-8">
                  <div className="relative space-y-6">
                    {/* Vertical guide line */}
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200" />
                    {steps.map((s, i) => {
                      const done = i <= doneIdx;
                      const dt =
                        findTime(progressModal.item, [s]) ||
                        (s === "packaging" ? findTime(progressModal.item, ["start_packaging"]) : undefined);

                      return (
                        <div key={s} className="relative">
                          {/* Connector to next node */}
                          {i < steps.length - 1 && (
                            <div
                              className={`absolute left-3 top-7 h-10 w-px ${i < doneIdx ? "bg-[#8B1C1C]" : "bg-gray-200"}`}
                            />
                          )}

                          <div className="flex items-start gap-3">
                            <div
                              className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${
                                done
                                  ? "bg-[#8B1C1C] text-white border-[#8B1C1C]"
                                  : "bg-white text-gray-600 border-gray-300"
                              }`}
                            >
                              {done ? "✓" : i + 1}
                            </div>
                            <div className="flex-1">
                              <div className="font-semibold text-black">{stageLabel(s)}</div>
                              <div className="text-sm text-black/80">{dt ? dt.toLocaleString() : "Pending"}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="pt-6 text-right">
              <button onClick={() => setProgressModal(null)} className="px-4 py-2 bg-black text-white rounded">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Receipt Modal (unchanged structure) */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl p-6">
            <div className="text-center border-b pb-4 mb-4">
              <h2 className="text-2xl font-extrabold tracking-widest text-black">GRAND LINK</h2>
              <p className="text-sm text-black">Official Receipt</p>
            </div>

            <div className="space-y-4 text-sm text-black">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-black">Order ID</div>
                  <div className="font-mono text-xs">{selectedOrder.item.id}</div>
                </div>
                <div className="text-right">
                  <div className="text-black">Date</div>
                  <div>{new Date(selectedOrder.item.created_at).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-black">Product</div>
                  <div className="font-medium">{selectedOrder.product.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-black">Unit Price</div>
                  <div>{currency(selectedOrder.product.price || 0)}</div>
                </div>
              </div>

              <div className="border-t border-black pt-3">
                <div className="flex justify-between">
                  <span>Quantity</span>
                  <span>{selectedOrder.item.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{currency((selectedOrder.product.price || 0) * selectedOrder.item.quantity)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Reservation Fee</span>
                  <span>- {currency(500)}</span>
                </div>
                <div className="flex justify-between font-semibold text-lg border-t border-black pt-2">
                  <span>Balance Due</span>
                  <span className="text-black">
                    {currency((selectedOrder.product.price || 0) * selectedOrder.item.quantity - 500)}
                  </span>
                </div>
              </div>

              {/* NEW: Payment / ship / completed details */}
              <div className="border-t border-black pt-3 space-y-1">
                {(() => {
                  const paid = receiptSessions.find((s) => s.status === "completed") || receiptSessions[0];
                  const payMethod = paid?.payment_provider ? paid.payment_provider.toUpperCase() : "N/A";
                  const payTime = paid?.completed_at || paid?.created_at;
                  const shipTime =
                    findTime(selectedOrder.item, ["out_for_delivery"])?.toISOString() ||
                    findTime(selectedOrder.item, ["ready_for_delivery"])?.toISOString();
                const doneTime =
                    findTime(selectedOrder.item, ["completed"])?.toISOString() ||
                    selectedOrder.item.updated_at;

                  return (
                    <>
                      <div className="flex justify-between">
                        <span>Payment Method</span>
                        <span className="font-medium">{payMethod}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Payment Time</span>
                        <span>{payTime ? new Date(payTime).toLocaleString() : "N/A"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Ship Time</span>
                        <span>{shipTime ? new Date(shipTime).toLocaleString() : "Pending"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Completed Time</span>
                        <span>{doneTime ? new Date(doneTime).toLocaleString() : "Pending"}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="pt-3 flex gap-2">
              <button onClick={() => window.print()} className="flex-1 py-2 bg-black text-white rounded hover:opacity-90">
                Print
              </button>
              <button onClick={() => setSelectedOrder(null)} className="flex-1 py-2 bg-black text-white rounded hover:opacity-90">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}