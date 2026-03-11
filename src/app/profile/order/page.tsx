"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { ensureProductionWorkflow, PRODUCTION_STAGES } from "@/app/lib/productionWorkflow";
import { formatAddressLineFromRecord } from "@/utils/addressFields";
import InvoicePreviewModal from "@/components/InvoicePreviewModal";

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
  id?: string;
  full_name?: string | null;
  address?: string | null;
  full_address?: string | null;
  phone?: string | null;
  email?: string | null;
  province?: string | null;
  city?: string | null;
  postal_code?: string | null;
  label?: string | null;
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
  const [receiptAddress, setReceiptAddress] = useState<Address | null>(null);
  const [progressModal, setProgressModal] = useState<{ item: UserItem; product?: Product } | null>(null);
  const [invoicePreviewId, setInvoicePreviewId] = useState<string | null>(null);

  const [imagePreview, setImagePreview] = useState<{ urls: string[]; index: number; title?: string } | null>(null);
  const [imagePreviewZoom, setImagePreviewZoom] = useState(1);

  const [changeModal, setChangeModal] = useState<{ item: UserItem; product?: Product } | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [changeMethod, setChangeMethod] = useState<"delivery" | "pickup">("delivery");
  const [changeAddressId, setChangeAddressId] = useState<string>("");
  const [changeBranch, setChangeBranch] = useState<string>("");
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!imagePreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImagePreview(null);
      if (e.key === "ArrowLeft") setImagePreview((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p));
      if (e.key === "ArrowRight")
        setImagePreview((p) => (p ? { ...p, index: Math.min(p.urls.length - 1, p.index + 1) } : p));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imagePreview]);

  // Deep-link: /profile/order?openProgress=<user_item_id>
  useEffect(() => {
    if (typeof window === "undefined") return;

    const target = new URLSearchParams(window.location.search).get("openProgress") || "";
    if (!target) return;
    if (loading) return;
    if (progressModal) return;

    const item = items.find((it) => it.id === target);
    if (!item) return;

    const product = productsById[item.product_id];
    setProgressModal({ item, product });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items, productsById, progressModal]);

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
      material_preparation: "Material Preparation Stage",
      frame_fabrication_welding: "Frame Fabrication & Welding",
      glass_installation: "Glass Installation",
      sealant_application: "Sealant Application",
      quality_checking: "Quality Checking",
      in_production: "In Production",
      quality_check: "Quality Check",
      packaging: "Packaging",
      start_packaging: "Packaging",
      ready_for_delivery: "Ready for Delivery",
      out_for_delivery: "Out for Delivery",
      completed: "Delivered",
    }[k] || k.replace(/_/g, " "));

  const timelineSteps = ["approved", "in_production", "quality_check", "packaging", "ready_for_delivery", "out_for_delivery", "completed"];

  const normalizeTimelineStatus = (value: string) => {
    const normalized = String(value || "approved").trim().toLowerCase();
    if (!normalized || normalized === "accepted" || normalized === "pending_acceptance") return "approved";
    if (normalized === "start_packaging") return "packaging";
    return normalized;
  };

  const reachedIndex = (it: UserItem) => {
    const cur = normalizeTimelineStatus(it.order_status || it.order_progress || it.status || "approved");
    const idx = timelineSteps.indexOf(cur);
    return idx >= 0 ? idx : 0;
  };

  const openReceipt = async (item: UserItem) => {
    const product = productsById[item.product_id];
    setSelectedOrder({ item, product });
    setReceiptAddress(null);

    if (item.delivery_address_id) {
      const { data: addrData } = await supabase
        .from("addresses")
        .select("id,full_name,address,phone,email,is_default,full_address,province,city,postal_code,label")
        .eq("id", item.delivery_address_id)
        .maybeSingle();
      if (addrData) setReceiptAddress(addrData as Address);
    } else if (item.meta?.delivery_address) {
      setReceiptAddress(item.meta.delivery_address as Address);
    }

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
                      <p className="text-xs text-black mt-1">
                        via {item.payment_method.toUpperCase()}
                        {item.payment_method === "paymongo" && item.meta?.paymongo_channel
                          ? ` (${String(item.meta.paymongo_channel).toUpperCase()})`
                          : ""}
                      </p>
                    )}

                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => openReceipt(item)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        View Receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => setInvoicePreviewId(item.id)}
                        className="px-4 py-2 bg-[#8B1C1C] text-white rounded hover:bg-[#701313] text-sm inline-flex items-center"
                      >
                        Display Invoice
                      </button>
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
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
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
              const workflow = ensureProductionWorkflow(progressModal.item?.meta?.production_workflow);
              const status = String(
                progressModal.item?.order_status || progressModal.item?.order_progress || progressModal.item?.status || ""
              );
              const estimatedCompletionDate =
                workflow.estimated_completion_date || progressModal.item?.meta?.production_estimated_completion_date || null;
              const finalProductImages =
                workflow.final_product_images.length > 0
                  ? workflow.final_product_images
                  : Array.isArray(progressModal.item?.meta?.production_final_images)
                    ? (progressModal.item.meta.production_final_images as string[])
                    : [];
              const finalProductNote =
                workflow.final_product_note || progressModal.item?.meta?.production_final_note || null;
              const normalizedUpdates = updates
                .slice()
                .sort((a, b) => String(b.approved_at || "").localeCompare(String(a.approved_at || "")));
              const qcFromUpdates = normalizedUpdates.find((u) => !!u?.is_final_qc);
              const qcPayload = finalQc && typeof finalQc === "object" ? finalQc : qcFromUpdates;
              const timelineDoneIdx = reachedIndex(progressModal.item);
              const productionStartedAt = workflow.started_at
                ? new Date(workflow.started_at)
                : findTime(progressModal.item, ["in_production"]);

              const openPreview = (urls: string[], index: number, title?: string) => {
                if (!urls.length) return;
                setImagePreviewZoom(1);
                setImagePreview({ urls, index, title });
              };

              return (
                <>
                  {progressModal.product && (
                    <div className="mb-6 flex items-center gap-3 rounded border p-3">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border bg-white">
                        {(() => {
                          const p = progressModal.product;
                          const img = (Array.isArray(p.images) && p.images[0]) || p.image1 || p.image2 || "";
                          return img ? (
                            <img src={img} alt={p.name || "Product"} className="h-full w-full object-cover" />
                          ) : (
                            <div className="text-xs text-black/60">No image</div>
                          );
                        })()}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-black">{progressModal.product.name || "Product"}</div>
                        <div className="text-xs text-black/70">Status: {stageLabel(status || "approved")}</div>
                      </div>
                    </div>
                  )}

                  <div className="mb-6 rounded-xl border border-black/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-black">Production Progress</div>
                        <div className="mt-1 text-xs text-black/70">Approved stage evidence is reflected here.</div>
                      </div>
                      <div className="text-sm font-semibold text-black">{pct}%</div>
                    </div>
                    <div className="mt-3 h-3 w-full overflow-hidden rounded bg-gray-200">
                      <div className="h-3 bg-[#8B1C1C]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-black/70">
                      <span>Estimated completion: {estimatedCompletionDate ? new Date(estimatedCompletionDate).toLocaleDateString() : "Not set"}</span>
                      <span>Team members: {workflow.team_members.length}</span>
                    </div>
                  </div>

                  {finalProductImages.length > 0 ? (
                    <div className="mb-8 rounded-xl border border-black/10 p-4">
                      <div className="text-sm font-semibold text-black">Final Product Preview</div>
                      {finalProductNote ? <div className="mt-2 text-sm text-black whitespace-pre-wrap">{finalProductNote}</div> : null}
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {finalProductImages.map((url, idx) => (
                          <button key={url + idx} type="button" onClick={() => openPreview(finalProductImages, idx, "Final Product")}> 
                            <img src={url} alt="Final product" className="h-24 w-full rounded border object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="pl-8">
                    <div className="relative space-y-6">
                      <div className="absolute bottom-0 left-3 top-0 w-px bg-gray-200" />
                      {timelineSteps.map((step, index, all) => {
                        const done = step === "approved" ? true : timelineDoneIdx >= index;
                        const dt =
                          step === "approved"
                            ? findTime(progressModal.item, ["approved"]) || findTime(progressModal.item, ["accepted"])
                            : step === "in_production"
                              ? productionStartedAt || undefined
                            : findTime(progressModal.item, [step]) ||
                              (step === "packaging" ? findTime(progressModal.item, ["start_packaging"]) : undefined);

                        return (
                          <div key={step} className="relative">
                            {index < all.length - 1 ? (
                              <div className={`absolute left-3 top-7 h-10 w-px ${done ? "bg-[#8B1C1C]" : "bg-gray-200"}`} />
                            ) : null}
                            <div className="flex items-start gap-3">
                              <div
                                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                                  done
                                    ? "border-[#8B1C1C] bg-[#8B1C1C] text-white"
                                    : "border-gray-300 bg-white text-gray-600"
                                }`}
                              >
                                {done ? "✓" : index + 1}
                              </div>
                              <div className="flex-1">
                                <div className="font-semibold text-black">{stageLabel(step)}</div>
                                <div className="text-sm text-black/80">{dt ? dt.toLocaleString() : "Pending"}</div>

                                {step === "in_production" ? (
                                  <div className="mt-4 rounded-xl border border-black/10 bg-gray-50 p-4">
                                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/60">
                                      In Production
                                    </div>
                                    <div className="mb-3 text-xs text-black/60">
                                      Stages of how the product is constructed.
                                    </div>
                                    <div className="relative space-y-4">
                                      <div className="absolute bottom-0 left-3 top-0 w-px bg-gray-200" />
                                      {PRODUCTION_STAGES.map((stage, stageIndex, stageList) => {
                                        const stagePlan = workflow.stage_plans.find((entry) => entry.key === stage.key);
                                        const stageUpdates = normalizedUpdates.filter((update) => {
                                          const updateStageKey = String(update?.stage_key || "");
                                          if (updateStageKey) return updateStageKey === stage.key;
                                          return stageIndex === 0 && !update?.is_final_qc;
                                        });
                                        const stageDone = stagePlan?.status === "approved";
                                        const stageInProgress = stagePlan?.status === "in_progress";

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
                                                {stageDone ? "✓" : stageIndex + 1}
                                              </div>
                                              <div className="flex-1 pb-2">
                                                <div className="font-semibold text-black">{stage.label}</div>
                                                <div className="text-sm text-black/70">
                                                  {stageDone
                                                    ? `Approved${stagePlan?.approved_at ? ` • ${new Date(stagePlan.approved_at).toLocaleString()}` : ""}`
                                                    : stageInProgress
                                                      ? "Waiting for final approval"
                                                      : "Pending"}
                                                </div>

                                                <div className="mt-2 flex flex-wrap gap-2">
                                                  {(workflow.team_members || [])
                                                    .filter((member) =>
                                                      member.role_keys.some((roleKey) =>
                                                        stage.roleKeys.some((allowedRole) => allowedRole === roleKey)
                                                      )
                                                    )
                                                    .map((member) => (
                                                      <span
                                                        key={`${stage.key}-${member.admin_id}`}
                                                        className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black/70"
                                                      >
                                                        {member.admin_name}
                                                      </span>
                                                    ))}
                                                </div>

                                                <div className="mt-3 space-y-3">
                                                  {stageUpdates.length === 0 ? (
                                                    <div className="text-sm text-black/60">No approved evidence yet.</div>
                                                  ) : (
                                                    stageUpdates.slice(0, 2).map((update, updateIndex) => {
                                                      const imgs = Array.isArray(update.image_urls) ? update.image_urls : [];
                                                      return (
                                                        <div
                                                          key={String(update.task_update_id || update.id || updateIndex)}
                                                          className="rounded-lg border border-black/10 bg-white p-3"
                                                        >
                                                          <div className="flex items-center justify-between gap-3 text-xs text-black/60">
                                                            <span>{update.submitted_by_name || update.employee_name || "Production team"}</span>
                                                            <span>{update.approved_at ? new Date(update.approved_at).toLocaleString() : ""}</span>
                                                          </div>
                                                          {update.description ? (
                                                            <div className="mt-2 whitespace-pre-wrap text-sm text-black">{update.description}</div>
                                                          ) : null}
                                                          {imgs.length > 0 ? (
                                                            <div className="mt-3 grid grid-cols-3 gap-2">
                                                              {imgs.map((url: string, imgIndex: number) => (
                                                                <button
                                                                  key={url + imgIndex}
                                                                  type="button"
                                                                  onClick={() => openPreview(imgs, imgIndex, stage.label)}
                                                                >
                                                                  <img
                                                                    src={url}
                                                                    alt="Stage evidence"
                                                                    className="h-20 w-full rounded border object-cover"
                                                                  />
                                                                </button>
                                                              ))}
                                                            </div>
                                                          ) : null}
                                                        </div>
                                                      );
                                                    })
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ) : null}

                                {step === "quality_check" && qcPayload && (qcPayload.description || (Array.isArray(qcPayload.image_urls) && qcPayload.image_urls.length > 0)) ? (
                                  <div className="mt-3 rounded-lg border p-3">
                                    {qcPayload.description ? <div className="text-sm text-black whitespace-pre-wrap">{qcPayload.description}</div> : null}
                                    {Array.isArray(qcPayload.image_urls) && qcPayload.image_urls.length > 0 ? (
                                      <div className="mt-3 grid grid-cols-3 gap-2">
                                        {qcPayload.image_urls.map((url: string, idx: number) => (
                                          <button key={url + idx} type="button" onClick={() => openPreview(qcPayload.image_urls, idx, "Quality Check")}> 
                                            <img src={url} alt="Quality check" className="h-20 w-full rounded border object-cover" />
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
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

      <InvoicePreviewModal
        userItemId={invoicePreviewId}
        onClose={() => setInvoicePreviewId(null)}
      />

      {/* Image preview overlay (used from Order Progress) */}
      {imagePreview && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 p-4 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setImagePreview(null);
          }}
        >
          <div className="w-full max-w-4xl bg-white rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="text-sm font-semibold text-black truncate">
                {imagePreview.title || "Image"} ({imagePreview.index + 1}/{imagePreview.urls.length})
              </div>
              <button
                type="button"
                className="text-black text-xl"
                onClick={() => setImagePreview(null)}
                aria-label="Close image preview"
              >
                ×
              </button>
            </div>

            <div className="bg-black flex items-center justify-center" style={{ height: "70vh" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview.urls[imagePreview.index]}
                alt=""
                className="max-h-full max-w-full"
                style={{ transform: `scale(${imagePreviewZoom})`, transformOrigin: "center" }}
              />
            </div>

            <div className="px-4 py-3 border-t flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded border text-sm"
                  onClick={() => setImagePreview((p) => (p ? { ...p, index: Math.max(0, p.index - 1) } : p))}
                  disabled={imagePreview.index <= 0}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded border text-sm"
                  onClick={() =>
                    setImagePreview((p) => (p ? { ...p, index: Math.min(p.urls.length - 1, p.index + 1) } : p))
                  }
                  disabled={imagePreview.index >= imagePreview.urls.length - 1}
                >
                  Next
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-3 py-1 rounded border text-sm"
                  onClick={() => setImagePreviewZoom((z) => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                  disabled={imagePreviewZoom <= 1}
                >
                  Zoom −
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded border text-sm"
                  onClick={() => setImagePreviewZoom(1)}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded border text-sm"
                  onClick={() => setImagePreviewZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                >
                  Zoom +
                </button>
              </div>

              <a
                className="px-3 py-1 rounded bg-black text-white text-sm"
                href={imagePreview.urls[imagePreview.index]}
                target="_blank"
                rel="noreferrer"
              >
                Open in new tab
              </a>
            </div>
          </div>
        </div>
      )}
      {selectedOrder && (
        <>
          <style jsx global>{`
            @media print {
              @page {
                size: A4;
                margin: 15mm;
              }

              body * {
                visibility: hidden;
              }

              #order-receipt-print-area,
              #order-receipt-print-area * {
                visibility: visible;
              }

              #order-receipt-print-area {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                page-break-after: avoid;
                page-break-inside: avoid;
              }

              .no-print {
                display: none !important;
              }
            }
          `}</style>

          <div className="fixed inset-0 bg-transparent flex items-center justify-center z-50 p-4">
            <div className="bg-white bg-opacity-95 backdrop-blur-sm rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
              <div className="no-print flex justify-between items-center p-4 border-b bg-white bg-opacity-80">
                <h2 className="text-lg font-semibold text-gray-800">Order Receipt</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    Print
                  </button>
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                  >
                    ✕ Close
                  </button>
                </div>
              </div>

              <div
                id="order-receipt-print-area"
                className="p-8 bg-white bg-opacity-90"
                style={{ maxWidth: "210mm", margin: "0 auto" }}
              >
                <div className="text-center mb-8 border-b-2 border-gray-300 pb-6">
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">GRAND EAST</h1>
                  <p className="text-sm text-gray-600">Order Receipt</p>
                  <p className="text-xs text-gray-500 mt-1">Thank you for ordering with us</p>
                </div>

                <div className="mb-6">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Order ID</p>
                      <p className="text-gray-900 font-mono text-xs break-all">{selectedOrder.item.id}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Status</p>
                      <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gray-900 text-white">
                        {stageLabel(String(selectedOrder.item.order_status || selectedOrder.item.order_progress || selectedOrder.item.status || "pending"))}
                      </span>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Date Created</p>
                      <p className="text-gray-900">
                        {new Date(selectedOrder.item.created_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 font-medium mb-1">Quantity</p>
                      <p className="text-gray-900 font-semibold">{selectedOrder.item.quantity} unit(s)</p>
                    </div>
                  </div>
                </div>

                <div className="mb-6 border-t border-b border-gray-200 py-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Product Details</h3>
                  <div className="flex items-start gap-4">
                    <div className="w-20 h-20 bg-gray-100 rounded flex-shrink-0 overflow-hidden">
                      <Image
                        src={selectedOrder.product.images?.[0] || selectedOrder.product.image1 || "/no-image.png"}
                        alt={selectedOrder.product.name || "Product"}
                        width={80}
                        height={80}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 text-lg">{selectedOrder.product.name}</p>
                      {(selectedOrder.item.meta?.selected_branch || selectedOrder.item.meta?.branch) ? (
                        <p className="text-sm text-gray-600 mt-1">
                          <span className="font-medium">Branch:</span> {selectedOrder.item.meta?.selected_branch || selectedOrder.item.meta?.branch}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Payment Summary</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Unit Price</span>
                      <span className="text-gray-900 font-medium">{currency(Number(selectedOrder.item.meta?.product_price ?? selectedOrder.product.price ?? 0))}</span>
                    </div>
                    {selectedOrder.item.meta?.reservation_fee ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Delivery Fee</span>
                        <span className="text-gray-900 font-medium">{currency(Number(selectedOrder.item.meta.reservation_fee))}</span>
                      </div>
                    ) : null}
                    {selectedOrder.item.meta?.discount_value ? (
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Discount</span>
                        <span className="font-medium">-{currency(Number(selectedOrder.item.meta.discount_value))}</span>
                      </div>
                    ) : null}
                    <div className="border-t border-gray-300 pt-2 mt-2">
                      <div className="flex justify-between">
                        <span className="text-gray-900 font-bold text-lg">Total Amount</span>
                        <span className="text-gray-900 font-bold text-xl">
                          {currency(Number(selectedOrder.item.total_amount ?? selectedOrder.item.total_paid ?? ((selectedOrder.product.price || 0) * selectedOrder.item.quantity)))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {(() => {
                  const addr = receiptAddress || (selectedOrder.item.meta?.delivery_address as Address | undefined);
                  if (!addr) return null;
                  return (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Delivery Information</h3>
                      <div className="bg-gray-50 rounded-lg p-4 text-sm">
                        {addr.full_name ? <p className="text-gray-900 font-medium">{addr.full_name}</p> : null}
                        <p className="text-gray-600 mt-1">{formatAddressLineFromRecord(addr)}</p>
                        {addr.phone ? <p className="text-gray-600">{addr.phone}</p> : null}
                        {addr.email ? <p className="text-gray-600">{addr.email}</p> : null}
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                  <p className="text-xs text-gray-500 mb-2">
                    This is an official receipt from Grand East. For inquiries, please contact our customer service.
                  </p>
                  <p className="text-xs text-gray-400">
                    Generated on {new Date().toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}