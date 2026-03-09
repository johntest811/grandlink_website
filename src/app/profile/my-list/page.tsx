"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

type UserItem = {
  id: string;
  user_id: string;
  product_id: string;
  item_type: string;
  status: string;
  quantity: number;
  meta: any;
  created_at: string;
};

type Product = {
  id: string;
  name?: string;
  images?: string[];
  image1?: string;
  image2?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function ProfileMyListPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<UserItem[]>([]);
  const [productsById, setProductsById] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [moving, setMoving] = useState(false);

  const loadMyList = useCallback(async (uid?: string | null) => {
    const resolvedUserId = uid ?? userId;

    if (!resolvedUserId) {
      setUserId(null);
      setItems([]);
      setProductsById({});
      setSelected({});
      return;
    }

    const { data: uiData, error: uiErr } = await supabase
      .from("user_items")
      .select("*")
      .eq("user_id", resolvedUserId)
      .eq("item_type", "my-list")
      .order("created_at", { ascending: false });

    if (uiErr) throw uiErr;

    const userItems = (uiData ?? []) as UserItem[];
    setItems(userItems);
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      userItems.forEach((item) => {
        if (prev[item.id]) next[item.id] = true;
      });
      return next;
    });

    const productIds = Array.from(new Set(userItems.map((item) => item.product_id).filter(Boolean)));
    if (productIds.length === 0) {
      setProductsById({});
      return;
    }

    const { data: prodData, error: prodErr } = await supabase
      .from("products")
      .select("id, name, images, image1, image2")
      .in("id", productIds);

    if (prodErr) throw prodErr;

    const nextProducts: Record<string, Product> = {};
    (prodData ?? []).forEach((product) => {
      nextProducts[product.id] = product;
    });
    setProductsById(nextProducts);
  }, [userId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = (userData as any)?.user?.id ?? null;
        if (!uid) {
          await loadMyList(null);
          setLoading(false);
          return;
        }
        setUserId(uid);
        await loadMyList(uid);
      } catch (e) {
        console.error("load wishlist error", e);
        setItems([]);
        setProductsById({});
      } finally {
        setLoading(false);
      }
    };

    load();

    return () => {
      // no-op cleanup kept here to mirror the async loader lifecycle
    };
  }, [loadMyList]);

  useEffect(() => {
    const refreshMyList = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = (userData as any)?.user?.id ?? null;
        setUserId(uid);
        await loadMyList(uid);
      } catch (e) {
        console.error("refresh wishlist error", e);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshMyList();
      }
    };

    const onFocus = () => {
      void refreshMyList();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadMyList]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const p = productsById[it.product_id];
      const title = (p?.name ?? it.meta?.name ?? "").toLowerCase();
      return title.includes(q) || it.id.toLowerCase().includes(q);
    });
  }, [items, productsById, query]);

  const removeItem = async (id: string) => {
    if (!userId) return alert("Please log in.");
    setActionLoading(id);
    try {
      const { error } = await supabase.from("user_items").delete().eq("id", id).eq("user_id", userId);
      if (error) throw error;
      setItems((s) => s.filter((i) => i.id !== id));
    } catch (e) {
      console.error("remove wishlist item", e);
      alert("Could not remove item");
    } finally {
      setActionLoading(null);
    }
  };

  const moveToReserve = async (item: UserItem) => {
    if (!userId) return alert("Please log in.");
    
    // Get product info
    const product = productsById[item.product_id];
    if (!product) {
      alert("Product not found");
      return;
    }
    
    // Redirect to reservation page with product ID
    router.push(`/reservation?productId=${item.product_id}`);
  };

  const toggleOne = (id: string) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  };

  const allSelected = items.length > 0 && items.every((i) => selected[i.id]);
  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const next: Record<string, boolean> = {};
      items.forEach((i) => (next[i.id] = true));
      setSelected(next);
    }
  };

  const selectedItems = useMemo(() => items.filter((i) => selected[i.id]), [items, selected]);

  const moveSelectedToCart = async () => {
    if (!userId) return alert("Please log in.");
    if (selectedItems.length === 0) return alert("Please select at least one item.");
    setMoving(true);
    try {
      const movedIds = selectedItems.map((item) => item.id);

      await Promise.all(
        selectedItems.map(async (it) => {
          const body = {
            userId,
            productId: it.product_id,
            quantity: Math.max(1, Number(it.quantity || 1)),
            meta: { from: "my-list", wishlist_item_id: it.id, ...(it.meta || {}) },
          };
          const res = await fetch("/api/cart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d?.error || "Failed to add to cart");
          }
        })
      );

      const { error: deleteError } = await supabase
        .from("user_items")
        .delete()
        .eq("user_id", userId)
        .eq("item_type", "my-list")
        .in("id", movedIds);

      if (deleteError) {
        throw new Error("Items were added to cart, but could not be removed from My List.");
      }

      await loadMyList(userId);
      router.refresh();

      router.push("/profile/cart");
    } catch (e: any) {
      console.error("move to cart error", e);
      alert(e?.message || "Could not move items to cart");
    } finally {
      setMoving(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col px-8 py-8">
   

      <div className="mb-2">
        <input
          type="text"
          placeholder="Search your list"
          className="w-full border rounded px-4 py-2 bg-gray-100 text-gray-700"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <hr className="mb-4" />

      {/* Toolbar: selection + move */}
      {!loading && items.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span>Select all</span>
          </label>
          <button
            onClick={moveSelectedToCart}
            disabled={moving || selectedItems.length === 0}
            className={`px-4 py-2 rounded text-sm font-medium text-white transition ${
              selectedItems.length === 0 || moving
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {moving ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/70 border-t-white rounded-full animate-spin" />
                Moving to Cart...
              </span>
            ) : (
              <>Move Selected to Cart ({selectedItems.length})</>
            )}
          </button>
        </div>
      )}

      <div className="flex-1">
        {loading ? (
          <div className="py-16 text-center text-gray-600">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center border rounded bg-white py-16">
            <div className="flex flex-col items-center">
             
              <p className="mt-4 text-gray-600 text-lg font-medium">{userId ? "Your list is empty" : "Please log in to see your list"}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map((it) => {
              const p = productsById[it.product_id];
              const imgKey = p?.images?.[0] ?? p?.image1 ?? p?.image2;
              const imgUrl = imgKey
                ? (imgKey.startsWith("http")
                    ? imgKey
                    : `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/storage/v1/object/public/uploads/${imgKey.replace(/^\/+/, "")}`)
                : null;
              const title = p?.name ?? it.meta?.name ?? "Untitled";

              return (
                <div key={it.id} className="bg-white p-4 rounded shadow flex items-center gap-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 mt-1"
                    checked={!!selected[it.id]}
                    onChange={() => toggleOne(it.id)}
                    aria-label={`Select ${title}`}
                  />
                  <div className="w-28 h-20 bg-gray-100 flex items-center justify-center overflow-hidden rounded">
                    {imgUrl ? <img src={imgUrl} alt={title} className="w-full h-full object-cover" /> : <span className="text-gray-400">Image</span>}
                  </div>

                  <div className="flex-1">
                    <h3 className="font-semibold text-black">{title}</h3>
                    <div className="text-sm text-gray-500">Added: {new Date(it.created_at).toLocaleString()}</div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Link href={`/Product/details?id=${it.product_id}`} className="bg-[#8B1C1C] text-white px-3 py-2 rounded text-sm text-center">View</Link>
                    <button
                      onClick={() => moveToReserve(it)}
                      disabled={actionLoading === it.id}
                      className="bg-yellow-500 text-white px-3 py-2 rounded text-sm"
                    >
                      {actionLoading === it.id ? "..." : "Reserve Now"}
                    </button>
                    <button
                      onClick={() => removeItem(it.id)}
                      disabled={actionLoading === it.id}
                      className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm"
                    >
                      {actionLoading === it.id ? "..." : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}