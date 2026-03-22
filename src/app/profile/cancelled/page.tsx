"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getMetaFulfillmentMethod, PICKUP_ADDRESS } from "@/utils/fulfillment";

type UserItem = {
  id: string;
  user_id: string;
  product_id: string;
  item_type: string;
  status: string;
  quantity: number;
  meta: any;
  created_at: string;
  updated_at?: string;
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
  length?: number;
  width?: number;
  height?: number;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

function resolveProductImageUrl(imageValue: string | null | undefined) {
  const raw = String(imageValue || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const cleaned = raw.replace(/^\/+/, "");
  if (cleaned.startsWith("products/")) {
    return `${SUPABASE_URL}/storage/v1/object/public/${cleaned}`;
  }
  if (cleaned.startsWith("uploads/")) {
    return `${SUPABASE_URL}/storage/v1/object/public/${cleaned}`;
  }

  return `${SUPABASE_URL}/storage/v1/object/public/products/${cleaned}`;
}

export default function ProfileCancelledPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserItem[]>([]);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "cancelled" | "pending_cancellation">("all");
  const [receiptItem, setReceiptItem] = useState<UserItem | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user?.id) {
          setUserId(null);
          setItems([]);
          setProductsById({});
          setLoading(false);
          return;
        }

        const uid = userData.user.id;
        setUserId(uid);

        const { data: uiData, error: uiErr } = await supabase
          .from("user_items")
          .select("*")
          .eq("user_id", uid)
          .in("status", ["cancelled", "pending_cancellation"])
          .order("updated_at", { ascending: false });

        if (uiErr) {
          setItems([]);
          setProductsById({});
          setLoading(false);
          return;
        }

        const userItems = (uiData ?? []) as UserItem[];
        setItems(userItems);

        const productIds = Array.from(new Set(userItems.map((u) => u.product_id).filter(Boolean)));
        if (productIds.length) {
          const { data: prodData } = await supabase
            .from("products")
            .select("id, name, price, images, image1, image2, length, width, height")
            .in("id", productIds);

          const map: Record<string, Product> = {};
          (prodData ?? []).forEach((p: any) => {
            map[p.id] = p as Product;
          });
          setProductsById(map);
        } else {
          setProductsById({});
        }
      } finally {
        setLoading(false);
      }
    };

    load();

    // Realtime (subscribe after first load once uid is known)
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const setupRealtime = async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = (u as any)?.user?.id as string | undefined;
      if (!uid) return;
      channel = supabase
        .channel("cancelled_rt")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_items", filter: `user_id=eq.${uid}` },
          () => load()
        )
        .subscribe();
    };
    setupRealtime();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    let result = items;

    if (filter !== "all") {
      result = result.filter((item) => item.status === filter);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((it) => {
        const p = productsById[it.product_id];
        const title = (p?.name ?? it.meta?.product_name ?? "").toLowerCase();
        return title.includes(q) || it.id.toLowerCase().includes(q);
      });
    }

    return result;
  }, [items, productsById, query, filter]);

  const getStatusDisplay = (status: string) => {
    const statusMap = {
      cancelled: {
        label: "CANCELLED",
        color: "bg-red-100 text-red-800",
        icon: "❌",
        description: "This reservation has been cancelled and refund processed.",
      },
      pending_cancellation: {
        label: "CANCELLATION PENDING",
        color: "bg-orange-100 text-orange-800",
        icon: "⏳",
        description: "Cancellation request submitted, waiting for admin approval.",
      },
    } as const;
    return (statusMap as any)[status] || {
      label: status.toUpperCase(),
      color: "bg-gray-100 text-gray-800",
      icon: "📋",
      description: "Status information not available.",
    };
  };

  const getCancellationReason = (meta: any) => {
    const reasons = {
      user_requested: "Cancelled by customer request",
      admin_cancelled: "Cancelled by admin",
      payment_failed: "Cancelled due to payment failure",
      out_of_stock: "Cancelled - item out of stock",
      customer_service: "Cancelled by customer service",
    } as const;
    return (reasons as any)[meta?.cancellation_reason] || "Reason not specified";
  };

  const getRefundStatus = (item: UserItem) => {
    const refundStatuses = {
      processing: { label: "Processing Refund", color: "text-yellow-600", icon: "⏳" },
      completed: { label: "Refund Completed", color: "text-green-600", icon: "✅" },
      failed: { label: "Refund Failed", color: "text-red-600", icon: "❌" },
      pending: { label: "Refund Pending", color: "text-orange-600", icon: "🔄" },
    } as const;

    const status = (item.meta?.refund_status as keyof typeof refundStatuses) || "processing";
    return refundStatuses[status] || refundStatuses.processing;
  };

  // Replace the old window.open receipt with a popup
  const viewCancellationReceipt = (item: UserItem) => {
    setReceiptItem(item);
  };

  const contactSupport = (item: UserItem) => {
    const supportMessage = `Hi, I need help with my ${item.status === "cancelled" ? "cancelled" : "pending cancellation"} reservation. Reservation ID: ${item.id}, Product: ${productsById[item.product_id]?.name || item.meta?.product_name || "N/A"}, Status: ${getStatusDisplay(item.status).label}.`;

    window.dispatchEvent(
      new CustomEvent("gl:open-chat", {
        detail: { message: supportMessage },
      })
    );
  };

  const reorder = async (item: UserItem) => {
    if (!userId) return;
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          productId: item.product_id,
          quantity: item.quantity || 1,
          meta: item.meta || {},
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to add to cart");
      router.push("/profile/cart");
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };

  const cancelledCount = items.filter((i) => i.status === "cancelled").length;
  const pendingCount = items.filter((i) => i.status === "pending_cancellation").length;

  return (
    <section className="flex-1 flex flex-col px-8 py-8">
      <div className="mb-6">
        {/* Make gray text black */}
        <h1 className="text-2xl font-bold text-black mb-2">Cancelled Reservations</h1>
        <p className="text-black text-sm mb-4">View your cancelled reservations and track refund status</p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-red-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-red-600">{cancelledCount}</div>
            <div className="text-sm text-red-700">Cancelled</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-orange-600">{pendingCount}</div>
            <div className="text-sm text-orange-700">Pending Cancellation</div>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-600">{items.length}</div>
            <div className="text-sm text-blue-700">Total</div>
          </div>
        </div>

        <div className="flex gap-4 mb-4">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="border rounded px-3 py-2 bg-white text-black"
          >
            <option value="all">All Cancellations</option>
            <option value="cancelled">Cancelled</option>
            <option value="pending_cancellation">Pending Cancellation</option>
          </select>
        </div>

        <input
          type="text"
          placeholder="Search cancelled reservations"
          className="w-full border rounded px-4 py-2 bg-gray-100 text-black placeholder:text-black/60 focus:bg-white focus:border-blue-400"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <hr className="mb-6" />

      <div className="flex-1">
        {loading ? (
          <div className="py-16 text-center text-black">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700 mx-auto mb-4"></div>
            <p>Loading cancelled reservations...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center border rounded bg-white py-16">
            <div className="flex flex-col items-center">
              <div className="text-6xl mb-4">{filter === "all" ? "📋" : filter === "cancelled" ? "❌" : "⏳"}</div>
              <p className="mt-4 text-black text-lg font-medium">
                {userId ? `No ${filter === "all" ? "" : filter.replace("_", " ")} reservations found` : "Please log in to see your cancelled reservations"}
              </p>
              <p className="text-black/70 text-sm mt-2">{query ? "Try adjusting your search terms" : "Your cancelled items will appear here"}</p>
              {userId && (
                <div className="mt-4 space-x-4">
                  <Link href="/profile/reserve" className="bg-[#8B1C1C] text-white px-6 py-2 rounded hover:bg-red-800 transition-colors">
                    View Active Reservations
                  </Link>
                  <Link href="/Product" className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700 transition-colors">
                    Browse Products
                  </Link>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {filtered.map((it) => {
              const p = productsById[it.product_id];
              const imgKey = p?.images?.[0] ?? p?.image1 ?? p?.image2 ?? it.meta?.product_image;
              const imgUrl = resolveProductImageUrl(imgKey);
              const title = p?.name ?? it.meta?.product_name ?? "Untitled Product";

              const statusDisplay = getStatusDisplay(it.status);
              const refundStatus = getRefundStatus(it);
              const reservationFee = Number(it.meta?.reservation_fee ?? 0);
              const totalPrice = it.total_amount || it.total_paid || ((p?.price || it.meta?.product_price || 0) * it.quantity);
              // Define refundAmount for card section (was causing ReferenceError)
              const refundAmount = Number(it.meta?.refund_amount ?? reservationFee);

              return (
                <div key={it.id} className="bg-white rounded-lg shadow-md overflow-hidden border">
                  <div className="bg-gray-50 px-6 py-4 border-b">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg text-black">Reservation #{it.id.slice(-8)}</h3>
                        <p className="text-sm text-black">Originally created: {new Date(it.created_at).toLocaleDateString()}</p>
                        <p className="text-sm text-black">
                          {it.status === "cancelled" ? "Cancelled" : "Cancellation requested"}:{" "}
                          {new Date(it.updated_at || it.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${statusDisplay.color} mb-2`}>
                          <span>{statusDisplay.icon}</span>
                          {statusDisplay.label}
                        </span>
                        <div className={`text-sm ${refundStatus.color} flex items-center gap-1`}>
                          <span>{refundStatus.icon}</span>
                          {refundStatus.label}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="flex gap-6">
                      <div className="w-32 h-32 bg-gray-100 flex items-center justify-center overflow-hidden rounded-lg flex-shrink-0">
                        {imgUrl ? (
                          <img src={imgUrl} alt={title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-black text-center opacity-60">
                            <div className="text-2xl mb-1">📦</div>
                            <div className="text-xs">No Image</div>
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <h4 className="font-semibold text-xl text-black mb-2">{title}</h4>

                        <div className="grid grid-cols-2 gap-4 mb-4 text-sm text-black">
                          <div>
                            <span className="text-black">Quantity:</span>
                            <span className="ml-2 font-medium">{it.quantity} pcs</span>
                          </div>
                          <div>
                            <span className="text-black">Dimensions:</span>
                            <span className="ml-2 font-medium">
                              {it.meta?.length || p?.length || "N/A"}×{it.meta?.width || p?.width || "N/A"}×{it.meta?.height || p?.height || "N/A"}cm
                            </span>
                          </div>
                          <div>
                            <span className="text-black">Unit Price:</span>
                            <span className="ml-2 font-medium">₱{(p?.price || it.meta?.product_price || 0).toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-black">Total Value:</span>
                            <span className="ml-2 font-medium">₱{totalPrice.toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="mb-4 p-3 bg-red-50 rounded">
                          <span className="text-sm font-medium text-red-800">Cancellation Reason:</span>
                          <p className="text-sm text-red-700 mt-1">{getCancellationReason(it.meta)}</p>
                        </div>

                        {it.meta?.admin_notes && (
                          <div className="mb-4 p-3 bg-blue-50 rounded">
                            <span className="text-sm font-medium text-blue-800">Admin Notes:</span>
                            <p className="text-sm text-blue-700 mt-1">{it.meta.admin_notes}</p>
                          </div>
                        )}

                        <div className="mb-4 p-3 bg-yellow-50 rounded">
                          <p className="text-sm text-yellow-700">{statusDisplay.description}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 bg-gray-50 p-4 rounded-lg">
                      <h5 className="font-semibold text-black mb-3">Refund Information</h5>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-black">
                          <span>Original Payment:</span>
                          <span>₱{reservationFee.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-black">
                          <span>Refund Amount:</span>
                          <span className="text-green-600">₱{refundAmount.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-black">
                          <span>Refund Status:</span>
                          <span className={`${refundStatus.color} font-medium flex items-center gap-1`}>
                            <span>{refundStatus.icon}</span>
                            {refundStatus.label}
                          </span>
                        </div>
                        {it.meta?.refund_reference && (
                          <div className="flex justify-between">
                            <span>Refund Reference:</span>
                            <span className="font-mono text-xs">{it.meta.refund_reference}</span>
                          </div>
                        )}
                        {it.meta?.estimated_refund_date && (
                          <div className="flex justify-between">
                            <span>Estimated Refund Date:</span>
                            <span>{new Date(it.meta.estimated_refund_date).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <button
                        onClick={() => viewCancellationReceipt(it)}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors text-sm"
                      >
                        📄 View Cancellation Receipt
                      </button>

                      <button
                        onClick={() => contactSupport(it)}
                        className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors text-sm"
                      >
                        📞 Contact Support
                      </button>

                      <Link
                        href={`/profile/invoice/${it.id}`}
                        className="bg-white border border-black/20 text-black px-4 py-2 rounded hover:bg-gray-100 transition-colors text-sm"
                      >
                        🧾 View Invoice
                      </Link>

                      <button
                        onClick={() => reorder(it)}
                        className="bg-black text-white px-4 py-2 rounded hover:bg-black/90 transition-colors text-sm"
                      >
                        🔁 Re-order
                      </button>

                      <Link
                        href={`/Product/details?id=${it.product_id}`}
                        className="bg-[#8B1C1C] text-white px-4 py-2 rounded hover:bg-red-800 transition-colors text-sm"
                      >
                        🔍 View Product Again
                      </Link>

                      {it.status === "pending_cancellation" && (
                        <div className="bg-orange-100 text-orange-800 px-4 py-2 rounded text-sm flex items-center gap-2">
                          <span>⏳</span>
                          <span>Awaiting admin approval for cancellation</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 p-3 bg-blue-50 rounded text-xs">
                      <p className="text-blue-700">
                        <strong>Need help?</strong> For questions about refunds or cancellations, contact our support team at
                        support@grandlink.com or use the contact button above. Reference your reservation ID: {it.id}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* POPUP: Cancellation Receipt */}
      {receiptItem && (
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

              #cancelled-receipt-print,
              #cancelled-receipt-print * {
                visibility: visible;
              }

              #cancelled-receipt-print {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                page-break-after: avoid;
                page-break-inside: avoid;
                max-height: 267mm;
                overflow: hidden;
              }

              .no-print {
                display: none !important;
              }

              #cancelled-receipt-print .mb-8 {
                margin-bottom: 1rem !important;
              }

              #cancelled-receipt-print .mb-6 {
                margin-bottom: 0.75rem !important;
              }

              #cancelled-receipt-print .p-8 {
                padding: 1rem !important;
              }

              #cancelled-receipt-print .p-4 {
                padding: 0.5rem !important;
              }

              #cancelled-receipt-print {
                font-size: 10pt;
              }

              #cancelled-receipt-print h1 {
                font-size: 20pt;
              }

              #cancelled-receipt-print h3 {
                font-size: 12pt;
              }
            }
          `}</style>

          <div className="fixed inset-0 bg-transparent flex items-center justify-center z-50 p-4">
            <div className="bg-white bg-opacity-95 backdrop-blur-sm rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
              <div className="no-print flex justify-between items-center p-4 border-b bg-white bg-opacity-80">
                <h2 className="text-lg font-semibold text-gray-800">Cancellation Receipt</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    Print
                  </button>
                  <button
                    onClick={() => setReceiptItem(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                  >
                    Close
                  </button>
                </div>
              </div>

              {(() => {
                const item = receiptItem;
                const product = productsById[item.product_id];
                const totalPrice = item.total_amount || item.total_paid || ((product?.price || item.meta?.product_price || 0) * item.quantity);
                const fulfillmentMethod = getMetaFulfillmentMethod(item.meta);
                const pickupAddress = String(item.meta?.pickup_address || PICKUP_ADDRESS);
                const reservationFee = Number(item.meta?.reservation_fee ?? 0);
                const refundAmount = item.meta?.refund_amount || reservationFee;

                return (
                  <div id="cancelled-receipt-print" className="p-8 bg-white bg-opacity-90" style={{ maxWidth: "210mm", margin: "0 auto" }}>
                    <div className="text-center mb-8 border-b-2 border-gray-300 pb-6">
                      <h1 className="text-3xl font-bold text-gray-900 mb-2">GRAND EAST</h1>
                      <p className="text-sm text-gray-600">Cancellation Receipt</p>
                      <p className="text-xs text-gray-500 mt-1">Refund and status details</p>
                    </div>

                    <div className="mb-6">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Cancellation ID</p>
                          <p className="text-gray-900 font-mono text-xs break-all">{item.id}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Status</p>
                          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                            {item.status === "cancelled" ? "CANCELLED" : "PENDING CANCELLATION"}
                          </span>
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Created</p>
                          <p className="text-gray-900">{new Date(item.created_at).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Updated</p>
                          <p className="text-gray-900">{new Date(item.updated_at || item.created_at).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6 border-t border-b border-gray-200 py-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Product Details</h3>
                      <p className="font-semibold text-gray-900 text-lg">{product?.name || item.meta?.product_name || "Item"}</p>
                      <p className="text-sm text-gray-600 mt-1">Quantity: {item.quantity}</p>
                      {fulfillmentMethod === "pickup" ? (
                        <p className="text-sm text-gray-600">Pickup Address: {pickupAddress}</p>
                      ) : null}
                    </div>

                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Payment and Refund Summary</h3>
                      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Total Value</span>
                          <span className="text-gray-900 font-medium">₱{Number(totalPrice).toLocaleString()}</span>
                        </div>
                        {fulfillmentMethod === "delivery" ? (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Original Payment</span>
                            <span className="text-gray-900 font-medium">₱{Number(reservationFee).toLocaleString()}</span>
                          </div>
                        ) : null}
                        <div className="border-t border-gray-300 pt-2 mt-2">
                          <div className="flex justify-between">
                            <span className="text-gray-900 font-bold text-lg">Refund Amount</span>
                            <span className="text-gray-900 font-bold text-xl">₱{Number(refundAmount).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4 text-sm text-gray-700 space-y-1">
                      <div className="flex justify-between">
                        <span>Cancellation Reason</span>
                        <span>{getCancellationReason(item.meta)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Refund Status</span>
                        <span>{getRefundStatus(item).label}</span>
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                      <p className="text-xs text-gray-500 mb-2">
                        This is an official cancellation receipt from Grand East. For inquiries, contact customer support.
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
                );
              })()}
            </div>
          </div>
        </>
      )}
    </section>
  );
}