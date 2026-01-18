"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

      const itemIds = list.map((x) => x.id);
      if (itemIds.length) {
        // load product data
        const { data: prods, error: pErr } = await supabase
          .from("products")
          .select("id,name,price,images,image1,image2")
          .in("id", Array.from(new Set(list.map((x) => x.product_id))));
        if (pErr) throw pErr;
        const map: Record<string, Product> = {};
        (prods ?? []).forEach((p) => (map[p.id] = p as Product));
        setProducts(map);

        // load payment sessions for receipts
        const { data: sessions, error: sErr } = await supabase
          .from("payment_sessions")
          .select(
            "id,amount,currency,status,payment_provider,created_at,completed_at,paypal_order_id,stripe_session_id,user_item_id"
          )
          .in("user_item_id", itemIds)
          .order("created_at", { ascending: false });
        if (sErr) throw sErr;
        const byItem: Record<string, PaymentSession[]> = {};
        (sessions ?? []).forEach((s: any) => {
          const key = s.user_item_id as string;
          if (!byItem[key]) byItem[key] = [];
          byItem[key].push(s);
        });
        setReceipts(byItem);
      } else {
        setProducts({});
        setReceipts({});
      }
    } catch (e) {
      console.error("load completed error", e);
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
                      <Link
                        href={`/profile/invoice/${it.id}`}
                        className="inline-flex items-center gap-2 rounded-md border border-black/20 bg-white px-3 py-1 text-sm font-semibold text-black hover:bg-gray-100 transition"
                      >
                        View Invoice
                      </Link>
                      <button
                        onClick={() => reorder(it)}
                        className="inline-flex items-center gap-2 rounded-md bg-black px-3 py-1 text-sm font-semibold text-white hover:bg-black/90 transition"
                      >
                        Re-order
                      </button>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs bg-emerald-100 text-emerald-800 h-fit">COMPLETED</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xl rounded-lg bg-white shadow-lg">
            <div className="text-center border-b pb-4 mb-4 px-5 pt-4">
              <h2 className="text-2xl font-extrabold tracking-widest text-black">GRAND LINK</h2>
              <p className="text-sm text-black">Official Receipt</p>
            </div>

            {(() => {
              const product = products[selectedReceipt.item.product_id];
              return (
                <div className="px-5 pb-5 space-y-4 text-sm text-black max-h-[60vh] overflow-y-auto">
                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-black">Order ID</div>
                      <div className="font-mono text-xs">{selectedReceipt.item.id}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-black">Date</div>
                      <div>{new Date(selectedReceipt.item.created_at).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-black">Product</div>
                      <div className="font-medium">{product?.name || "Item"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-black">Unit Price</div>
                      <div>{currency(product?.price || 0)}</div>
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="border-t border-black pt-3">
                    <div className="flex justify-between">
                      <span>Quantity</span>
                      <span>{selectedReceipt.item.quantity}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Unit Price</span>
                      <span>{currency(product?.price || 0)}</span>
                    </div>
                    {selectedReceipt.item.meta?.addons_total > 0 && (
                      <div className="flex justify-between">
                        <span>Add-ons Total</span>
                        <span>{currency(selectedReceipt.item.meta.addons_total)}</span>
                      </div>
                    )}
                    {selectedReceipt.item.meta?.discount_value > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount</span>
                        <span>-{currency(selectedReceipt.item.meta.discount_value)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Reservation Fee</span>
                      <span>{currency(selectedReceipt.item.meta?.reservation_fee || 500)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-lg border-t border-black pt-2">
                      <span>Total Paid</span>
                      <span className="text-black">
                        {currency(selectedReceipt.item.total_amount || selectedReceipt.item.total_paid || (product?.price || 0) * selectedReceipt.item.quantity)}
                      </span>
                    </div>
                  </div>

                  {/* Payment / Ship / Completed times (same as order page) */}
                  <div className="border-t border-black pt-3 space-y-1">
                    {(() => {
                      const sessions = selectedReceipt.sessions || [];
                      const paid = sessions.find((s) => s.status === "completed") || sessions[0];
                      const payMethod = paid?.payment_provider ? paid.payment_provider.toUpperCase() : "N/A";
                      const payTime = paid?.completed_at || paid?.created_at;

                      const hist =
                        (selectedReceipt.item as any).progress_history ||
                        selectedReceipt.item.meta?.progress_history ||
                        [];
                      const tsOf = (keys: string[]) => {
                        const m = hist.find((h: any) => keys.includes(h.status));
                        return m?.updated_at ? new Date(m.updated_at).toLocaleString() : undefined;
                      };
                      const shipTime = tsOf(["out_for_delivery"]) || tsOf(["ready_for_delivery"]) || "Pending";
                      const completedTime =
                        tsOf(["completed"]) ||
                        (selectedReceipt.item.updated_at
                          ? new Date(selectedReceipt.item.updated_at).toLocaleString()
                          : "Pending");

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
                            <span>{shipTime}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Completed Time</span>
                            <span>{completedTime}</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* If there are sessions, optionally list them below (kept minimal) */}
                  {selectedReceipt.sessions.length === 0 ? (
                    <div className="rounded border p-4 text-sm">
                      No payment records yet. Your receipt will appear here once processed.
                    </div>
                  ) : null}
                </div>
              );
            })()}

            <div className="border-t px-5 py-3 text-right">
              <button
                onClick={() => window.print()}
                className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 mr-2"
              >
                Print
              </button>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}