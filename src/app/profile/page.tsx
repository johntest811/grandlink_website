"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type UserItem = {
  id: string;
  item_type: string;
  status: string;
  order_status?: string | null;
};

type CartItem = {
  id: string;
};

type OverviewSource = "cart" | "my-list" | "reserve" | "order" | "completed" | "cancelled";

type SectionCount = {
  source: OverviewSource;
  label: string;
  href: string;
  count: number;
  badgeClass: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function UserProfilePage() {
  const [userItems, setUserItems] = useState<UserItem[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  const ORDER_STAGES = [
    "approved",
    "accepted",
    "in_production",
    "quality_check",
    "packaging",
    "start_packaging",
    "ready_for_delivery",
    "out_for_delivery",
  ];

  const SOURCE_META: Record<OverviewSource, { label: string; href: string; badgeClass: string }> = {
    cart: {
      label: "Cart",
      href: "/profile/cart",
      badgeClass: "bg-blue-100 text-blue-800",
    },
    "my-list": {
      label: "My List",
      href: "/profile/my-list",
      badgeClass: "bg-purple-100 text-purple-800",
    },
    reserve: {
      label: "Reserve",
      href: "/profile/reserve",
      badgeClass: "bg-yellow-100 text-yellow-800",
    },
    order: {
      label: "Order",
      href: "/profile/order",
      badgeClass: "bg-indigo-100 text-indigo-800",
    },
    completed: {
      label: "Completed",
      href: "/profile/completed",
      badgeClass: "bg-emerald-100 text-emerald-800",
    },
    cancelled: {
      label: "Cancelled",
      href: "/profile/cancelled",
      badgeClass: "bg-red-100 text-red-800",
    },
  };

  const classifyUserItem = (item: UserItem): OverviewSource | null => {
    const stage = String(item.order_status || item.status || "").toLowerCase();
    const status = String(item.status || "").toLowerCase();

    if (item.item_type === "my-list") {
      return "my-list";
    }

    if (status === "completed") {
      return "completed";
    }

    if (status === "cancelled" || status === "pending_cancellation") {
      return "cancelled";
    }

    if (ORDER_STAGES.includes(stage)) {
      return "order";
    }

    if (
      item.item_type === "reservation" &&
      ["pending_payment", "reserved", "pending_balance_payment", "pending_cancellation"].includes(status)
    ) {
      return "reserve";
    }

    return null;
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = (userData as any)?.user?.id ?? null;
        if (!uid) {
          setUserItems([]);
          setCartItems([]);
          setLoading(false);
          return;
        }

        // user_items drive my-list/reserve/order/completed/cancelled pages
        const { data: uiData, error: uiErr } = await supabase
          .from("user_items")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: false });

        if (uiErr) throw uiErr;

        // cart page is backed by cart table
        const { data: cartData, error: cartErr } = await supabase
          .from("cart")
          .select("id,user_id,product_id,quantity,meta,created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false });

        if (cartErr) throw cartErr;

        setUserItems((uiData ?? []) as UserItem[]);
        setCartItems((cartData ?? []) as CartItem[]);
      } catch (e) {
        console.error("load all items error", e);
        setUserItems([]);
        setCartItems([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const sectionCounts = useMemo<SectionCount[]>(() => {
    const counts: Record<OverviewSource, number> = {
      cart: cartItems.length,
      "my-list": 0,
      reserve: 0,
      order: 0,
      completed: 0,
      cancelled: 0,
    };

    userItems.forEach((item) => {
      const source = classifyUserItem(item);
      if (source) counts[source] += 1;
    });

    return (Object.keys(SOURCE_META) as OverviewSource[]).map((source) => ({
      source,
      label: SOURCE_META[source].label,
      href: SOURCE_META[source].href,
      count: counts[source],
      badgeClass: SOURCE_META[source].badgeClass,
    }));
  }, [cartItems.length, userItems]);

  const grandTotal = useMemo(
    () => sectionCounts.reduce((sum, section) => sum + section.count, 0),
    [sectionCounts]
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <main className="flex-1 flex flex-row">
        <section className="flex-1 flex flex-col px-8 py-8">
          <div className="mb-6 rounded-lg border bg-white p-5 shadow-sm">
            <h1 className="text-2xl font-bold text-black">Profile Overview</h1>
            <p className="mt-1 text-sm text-gray-600">
              Current total items across Cart, My List, Reserve, Order, Completed, and Cancelled pages.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm text-white">
              <span className="font-medium">Grand Total Items</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-black font-bold">{grandTotal}</span>
            </div>
          </div>

          <div className="flex-1">
            {sectionCounts.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sectionCounts.map((section) => {
                  return (
                    <div key={section.source} className="bg-white p-5 rounded shadow border border-gray-200 flex items-center justify-between">
                      <div>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${section.badgeClass}`}>
                          {section.label}
                        </span>
                        <h3 className="mt-3 text-sm text-gray-600">Current Total Items</h3>
                        <p className="text-3xl font-bold text-black mt-1">{section.count}</p>
                      </div>
                      <Link href={section.href} className="bg-[#8B1C1C] text-white px-4 py-2 rounded hover:bg-[#a82c2c] text-sm">
                        Open
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center border rounded bg-white py-16">
                <div className="flex flex-col items-center">
                  <p className="mt-4 text-gray-600 text-lg font-medium">No items found yet</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}