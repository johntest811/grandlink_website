"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { useRouter } from "next/navigation";
import InvoicePreviewModal from "@/components/InvoicePreviewModal";
import { getMetaFulfillmentMethod, PICKUP_ADDRESS } from "@/utils/fulfillment";

type Item = {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  updated_at?: string;
  status: string;
  order_progress?: string;
  meta: any;
  total_paid?: number;
  total_amount?: number;
  payment_method?: string;
};

type Product = { id: string; name?: string; price?: number; images?: string[]; image1?: string; image2?: string };

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

type ProductReviewRow = {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = (error as any).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export default function ProfileCompletedPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, PaymentSession[]>>({});
  const [selectedReceipt, setSelectedReceipt] = useState<{
    item: Item;
    sessions: PaymentSession[];
  } | null>(null);
  const [invoicePreviewId, setInvoicePreviewId] = useState<string | null>(null);
  const [myReviewsByProductId, setMyReviewsByProductId] = useState<Record<string, ProductReviewRow | null>>({});
  const [draftRatingByProductId, setDraftRatingByProductId] = useState<Record<string, number>>({});
  const [draftCommentByProductId, setDraftCommentByProductId] = useState<Record<string, string>>({});
  const [savingReviewByProductId, setSavingReviewByProductId] = useState<Record<string, boolean>>({});

  const load = async (uid: string) => {
    setLoading(true);
    try {
      const { data: ui, error } = await supabase
        .from("user_items")
        .select("*")
        .eq("user_id", uid)
        .eq("status", "completed")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      const list = (ui ?? []) as Item[];
      setItems(list);

      if (list.length) {
        // load product data
        const productIds = Array.from(new Set(list.map((x) => x.product_id).filter(Boolean)));
        const { data: prods, error: pErr } = await supabase
          .from("products")
          .select("id,name,price,images,image1,image2")
          .in("id", productIds);
        if (pErr) {
          console.warn("load completed products warning:", getErrorMessage(pErr));
        }
        const map: Record<string, Product> = {};
        (prods ?? []).forEach((p) => (map[p.id] = p as Product));
        setProducts(map);

        // load existing reviews for these products (best-effort)
        const { data: existingReviews, error: rErr } = await supabase
          .from("product_reviews")
          .select("id,product_id,user_id,rating,comment,created_at")
          .eq("user_id", uid)
          .in("product_id", productIds);

        if (rErr) {
          console.warn("load completed reviews warning:", getErrorMessage(rErr));
          setMyReviewsByProductId({});
        } else {
          const byProduct: Record<string, ProductReviewRow> = {};
          (existingReviews || []).forEach((row: any) => {
            if (!row?.product_id) return;
            byProduct[String(row.product_id)] = row as ProductReviewRow;
          });
          const normalized: Record<string, ProductReviewRow | null> = {};
          productIds.forEach((pid) => {
            normalized[String(pid)] = byProduct[String(pid)] || null;
          });
          setMyReviewsByProductId(normalized);

          // initialize drafts from existing values
          const nextRatings: Record<string, number> = {};
          const nextComments: Record<string, string> = {};
          productIds.forEach((pid) => {
            const existing = byProduct[String(pid)];
            nextRatings[String(pid)] = Math.max(1, Math.min(5, Number(existing?.rating || 5)));
            nextComments[String(pid)] = String(existing?.comment || "");
          });
          setDraftRatingByProductId(nextRatings);
          setDraftCommentByProductId(nextComments);
        }
      } else {
        setProducts({});
        setMyReviewsByProductId({});
        setDraftRatingByProductId({});
        setDraftCommentByProductId({});
        setSavingReviewByProductId({});
      }
    } catch (e) {
      console.error("load completed error:", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Get user id, initial load
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

  // Realtime refresh after userId is known (fixes uid scope error)
  useEffect(() => {
    if (!userId) return;

    const ch = supabase
      .channel("completed_rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_items", filter: `user_id=eq.${userId}` },
        () => load(userId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const p = products[it.product_id];
      return (p?.name ?? "").toLowerCase().includes(q) || it.id.toLowerCase().includes(q);
    });
  }, [items, products, query]);

  // Replace openReceipt to always open modal and fetch sessions now
  const openReceipt = async (item: Item) => {
    try {
      const { data, error } = await supabase
        .from("payment_sessions")
        .select(
          "id,amount,currency,status,payment_provider,created_at,completed_at,paypal_order_id,stripe_session_id"
        )
        .eq("user_item_id", item.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSelectedReceipt({ item, sessions: (data || []) as PaymentSession[] });
    } catch (e) {
      console.warn("Failed to load sessions, opening empty receipt:", e);
      setSelectedReceipt({ item, sessions: [] });
    }
  };

  // Add currency helper to match Order page
  const currency = (n?: number) => `₱${(n ?? 0).toLocaleString()}`;

  const reorder = async (item: Item) => {
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

  const setDraftRating = (productId: string, rating: number) => {
    const safe = Math.max(1, Math.min(5, Math.round(rating)));
    setDraftRatingByProductId((prev) => ({ ...prev, [productId]: safe }));
  };

  const setDraftComment = (productId: string, comment: string) => {
    setDraftCommentByProductId((prev) => ({ ...prev, [productId]: comment }));
  };

  const saveReview = async (productId: string) => {
    if (!userId) {
      alert("Please log in to rate products.");
      return;
    }

    const rating = Math.max(1, Math.min(5, Number(draftRatingByProductId[productId] || 5)));
    const trimmed = String(draftCommentByProductId[productId] || "").trim();
    const commentOrNull = trimmed ? trimmed : null;

    setSavingReviewByProductId((prev) => ({ ...prev, [productId]: true }));
    try {
      const { error } = await supabase
        .from("product_reviews")
        .upsert([{ product_id: productId, user_id: userId, rating, comment: commentOrNull }], {
          onConflict: "product_id,user_id",
        });

      if (error) throw error;

      const { data: refreshed, error: refreshErr } = await supabase
        .from("product_reviews")
        .select("id,product_id,user_id,rating,comment,created_at")
        .eq("product_id", productId)
        .eq("user_id", userId)
        .maybeSingle();
      if (refreshErr) throw refreshErr;

      setMyReviewsByProductId((prev) => ({ ...prev, [productId]: (refreshed as any) || null }));
      alert("Rating saved.");
    } catch (e) {
      alert(getErrorMessage(e));
    } finally {
      setSavingReviewByProductId((prev) => ({ ...prev, [productId]: false }));
    }
  };

  const renderStarsInput = (productId: string, current: number) => {
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: 5 }).map((_, i) => {
          const v = i + 1;
          const filled = current >= v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setDraftRating(productId, v)}
              className={filled ? "text-yellow-500" : "text-gray-300"}
              aria-label={`${v} star`}
              title={`${v} star`}
            >
              ★
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <section className="flex-1 flex flex-col px-8 py-8">
      <div className="mb-2">
        <input
          type="text"
          placeholder="Search completed orders"
          className="w-full border rounded px-4 py-2 bg-gray-100 text-gray-700"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <hr className="mb-4" />

      {loading ? (
        <div className="py-16 text-center text-gray-600">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center border rounded bg-white py-16">
          <div className="flex flex-col items-center">
            {/* <Image src="/no-orders.png" alt="No Completed" width={80} height={80} /> */}
            <p className="mt-4 text-gray-600 text-lg font-medium">No completed orders</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((it) => {
            const p = products[it.product_id];
            const img = p?.images?.[0] || p?.image1 || p?.image2 || "/no-image.png";
            const pid = String(it.product_id || "");
            const existing = myReviewsByProductId[pid] || null;
            const draftRating = draftRatingByProductId[pid] ?? Math.max(1, Math.min(5, Number(existing?.rating || 5)));
            const draftComment = draftCommentByProductId[pid] ?? String(existing?.comment || "");
            const saving = Boolean(savingReviewByProductId[pid]);
            return (
              <div key={it.id} className="bg-white p-6 rounded-lg shadow">
                <div className="flex gap-4">
                  <img src={img} className="w-20 h-20 object-cover rounded" alt={p?.name || "Product"} />
                  <div className="flex-1">
                    <div className="font-bold text-black">{p?.name || "Completed Item"}</div>
                    <div className="text-sm text-gray-600">Order ID: {it.id}</div>
                    <div className="text-xs text-gray-500">
                      Delivered: {new Date(it.updated_at || it.created_at).toLocaleString()}
                    </div>
                    <button
                      onClick={() => openReceipt(it)}
                      className="mt-3 inline-flex items-center gap-2 rounded-md bg-[#8B1C1C] px-3 py-1 text-sm font-semibold text-white hover:bg-[#701313] transition"
                    >
                      View Receipt
                    </button>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setInvoicePreviewId(it.id)}
                        className="inline-flex items-center gap-2 rounded-md border border-black/20 bg-white px-3 py-1 text-sm font-semibold text-black hover:bg-gray-100 transition"
                      >
                        Display Invoice
                      </button>
                      <button
                        onClick={() => reorder(it)}
                        className="inline-flex items-center gap-2 rounded-md bg-black px-3 py-1 text-sm font-semibold text-white hover:bg-black/90 transition"
                      >
                        Re-order
                      </button>
                    </div>

                    {/* Rating */}
                    {pid && (
                      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="text-sm font-semibold text-black">Rate this product</div>
                          {existing && (
                            <div className="text-xs text-gray-600">You already rated this product (saving will update it).</div>
                          )}
                        </div>

                        <div className="mt-2 flex items-center gap-3">
                          {renderStarsInput(pid, draftRating)}
                          <div className="text-xs text-gray-700">{draftRating}/5</div>
                        </div>

                        <textarea
                          value={draftComment}
                          onChange={(e) => setDraftComment(pid, e.target.value)}
                          rows={3}
                          maxLength={2000}
                          className="mt-2 w-full rounded border bg-white px-3 py-2 text-sm text-black"
                          placeholder="Optional comment (max 2000 chars)"
                        />

                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="text-xs text-gray-500">{draftComment.trim().length}/2000</div>
                          <button
                            type="button"
                            onClick={() => saveReview(pid)}
                            disabled={saving}
                            className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-50"
                          >
                            {saving ? "Saving…" : existing ? "Update Rating" : "Submit Rating"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs bg-emerald-100 text-emerald-800 h-fit">COMPLETED</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedReceipt && (
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

              #completed-receipt-print,
              #completed-receipt-print * {
                visibility: visible;
              }

              #completed-receipt-print {
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

              #completed-receipt-print .mb-8 {
                margin-bottom: 1rem !important;
              }

              #completed-receipt-print .mb-6 {
                margin-bottom: 0.75rem !important;
              }

              #completed-receipt-print .p-8 {
                padding: 1rem !important;
              }

              #completed-receipt-print .p-4 {
                padding: 0.5rem !important;
              }

              #completed-receipt-print {
                font-size: 10pt;
              }

              #completed-receipt-print h1 {
                font-size: 20pt;
              }

              #completed-receipt-print h3 {
                font-size: 12pt;
              }
            }
          `}</style>

          <div className="fixed inset-0 z-50 bg-transparent flex items-center justify-center p-4">
            <div className="bg-white bg-opacity-95 backdrop-blur-sm rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
              <div className="no-print flex justify-between items-center p-4 border-b bg-white bg-opacity-80">
                <h2 className="text-lg font-semibold text-gray-800">Completed Order Receipt</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                  >
                    Print
                  </button>
                  <button
                    onClick={() => setSelectedReceipt(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                  >
                    Close
                  </button>
                </div>
              </div>

              {(() => {
                const product = products[selectedReceipt.item.product_id];
                const fulfillmentMethod = getMetaFulfillmentMethod(selectedReceipt.item.meta);
                const pickupAddress = String(selectedReceipt.item.meta?.pickup_address || PICKUP_ADDRESS);
                const reservationFee = Number(selectedReceipt.item.meta?.reservation_fee ?? 0);
                const sessions = selectedReceipt.sessions || [];
                const paid = sessions.find((s) => s.status === "completed") || sessions[0];
                const payMethod = paid?.payment_provider ? paid.payment_provider.toUpperCase() : "N/A";

                return (
                  <div id="completed-receipt-print" className="p-8 bg-white bg-opacity-90" style={{ maxWidth: "210mm", margin: "0 auto" }}>
                    <div className="text-center mb-8 border-b-2 border-gray-300 pb-6">
                      <h1 className="text-3xl font-bold text-gray-900 mb-2">GRAND EAST</h1>
                      <p className="text-sm text-gray-600">Official Receipt</p>
                      <p className="text-xs text-gray-500 mt-1">Completed Order</p>
                    </div>

                    <div className="mb-6">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Order ID</p>
                          <p className="text-gray-900 font-mono text-xs break-all">{selectedReceipt.item.id}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Status</p>
                          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">COMPLETED</span>
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Created</p>
                          <p className="text-gray-900">{new Date(selectedReceipt.item.created_at).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium mb-1">Completed</p>
                          <p className="text-gray-900">{new Date(selectedReceipt.item.updated_at || selectedReceipt.item.created_at).toLocaleDateString("en-US", {
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
                      <p className="font-semibold text-gray-900 text-lg">{product?.name || "Item"}</p>
                      <p className="text-sm text-gray-600 mt-1">Quantity: {selectedReceipt.item.quantity}</p>
                      <p className="text-sm text-gray-600">Payment Method: {payMethod}</p>
                      {fulfillmentMethod === "pickup" ? (
                        <p className="text-sm text-gray-600">Pickup Address: {pickupAddress}</p>
                      ) : null}
                    </div>

                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Payment Summary</h3>
                      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Unit Price</span>
                          <span className="text-gray-900 font-medium">{currency(product?.price || 0)}</span>
                        </div>
                        {selectedReceipt.item.meta?.addons_total > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Add-ons</span>
                            <span className="text-gray-900 font-medium">{currency(selectedReceipt.item.meta.addons_total)}</span>
                          </div>
                        )}
                        {selectedReceipt.item.meta?.discount_value > 0 && (
                          <div className="flex justify-between text-sm text-green-600">
                            <span>Discount</span>
                            <span className="font-medium">-{currency(selectedReceipt.item.meta.discount_value)}</span>
                          </div>
                        )}
                        {fulfillmentMethod === "delivery" && reservationFee > 0 ? (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Delivery Fee</span>
                            <span className="text-gray-900 font-medium">{currency(reservationFee)}</span>
                          </div>
                        ) : null}
                        <div className="border-t border-gray-300 pt-2 mt-2">
                          <div className="flex justify-between">
                            <span className="text-gray-900 font-bold text-lg">Total Paid</span>
                            <span className="text-gray-900 font-bold text-xl">
                              {currency(selectedReceipt.item.total_amount || selectedReceipt.item.total_paid || (product?.price || 0) * selectedReceipt.item.quantity)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

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
                );
              })()}
            </div>
          </div>
        </>
      )}

      <InvoicePreviewModal
        userItemId={invoicePreviewId}
        onClose={() => setInvoicePreviewId(null)}
      />
    </section>
  );
}