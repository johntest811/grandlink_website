import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_ORIGIN || "https://adminside-grandlink.vercel.app";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Addon = { key: 'color_customization'; label: string; fee: number; value?: string };

function cents(n: number) { return Math.round((n || 0) * 100) / 100; }

export async function POST(req: NextRequest) {
  try {
    const { userId, itemIds, voucherCode, addonsByItemId } = await req.json() as {
      userId: string;
      itemIds: string[];                 // selected cart item ids
      voucherCode?: string | null;
      addonsByItemId?: Record<string, Addon[]>;
    };

    if (!userId || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json({ error: "userId and itemIds required" }, { status: 400 });
    }

    // Load selected cart items with product info
    const { data: cartItems, error: cartErr } = await supabase
      .from("user_items")
      .select("id,user_id,product_id,quantity,meta,products(id,name,price,inventory)")
      .eq("user_id", userId)
      .eq("item_type", "cart")
      .in("id", itemIds);

    if (cartErr) return NextResponse.json({ error: cartErr.message }, { status: 500 });

    const items = (cartItems || []).map((ci: any) => {
      const basePrice = Number(ci.products?.price || 0);
      const qty = Number(ci.quantity || 1);
      const addons = (addonsByItemId?.[ci.id] || []) as Addon[];
      const addonsTotal = addons.reduce((acc, a) => acc + Number(a.fee || 0), 0);
      const lineTotal = (basePrice + addonsTotal) * qty;
      return {
        cartId: ci.id,
        product_id: ci.product_id,
        product_name: ci.products?.name || "Product",
        qty,
        basePrice,
        addons,
        addonsTotal,
        lineTotal: cents(lineTotal),
        meta: ci.meta || {}
      };
    });

    const subtotal = cents(items.reduce((acc, it) => acc + it.lineTotal, 0));
    // Validate voucher
    let discount = 0;
    let appliedVoucher: any = null;
    if (voucherCode) {
      const { data: v } = await supabase
        .from("discount_codes")
        .select("*")
        .eq("code", voucherCode.toUpperCase())
        .eq("active", true)
        .maybeSingle();

      const now = new Date();
      const valid =
        v &&
        (!v.starts_at || new Date(v.starts_at) <= now) &&
        (!v.expires_at || new Date(v.expires_at) >= now) &&
        subtotal >= Number(v.min_subtotal || 0) &&
        (!v.max_uses || Number(v.used_count || 0) < Number(v.max_uses || 0));

      if (valid) {
        if (v.type === "percent") discount = cents(subtotal * (Number(v.value) / 100));
        else discount = cents(Number(v.value));
        appliedVoucher = v;
      }
    }
    const total = Math.max(0, cents(subtotal - discount));

    // Create reservation rows from cart items (one user_item per product)
    const nowIso = new Date().toISOString();
    const reservationRows = items.map((it) => ({
      user_id: userId,
      product_id: it.product_id,
      item_type: "order",            // or "reservation" if you prefer
      status: "pending_payment",
      order_status: "pending_payment",
      quantity: it.qty,
      price: it.basePrice,
      total_amount: it.lineTotal,
      meta: {
        ...it.meta,
        product_name: it.product_name,
        addons: it.addons,
        voucher_code: appliedVoucher?.code || null,
        voucher_discount: discount > 0 ? discount : 0,
        line_total: it.lineTotal
      },
      created_at: nowIso,
      updated_at: nowIso
    }));

    const { data: created, error: insErr } = await supabase
      .from("user_items")
      .insert(reservationRows)
      .select("id");

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    const userItemIds = (created || []).map((r: any) => r.id);

    // Optional: consume one voucher usage
    if (appliedVoucher?.id) {
      await supabase
        .from("discount_codes")
        .update({ used_count: (appliedVoucher.used_count || 0) + 1 })
        .eq("id", appliedVoucher.id);
    }

    // Clear purchased items from cart
    await supabase.from("user_items").delete().in("id", itemIds).eq("item_type", "cart");

    // Notify admin (server-to-server)
    try {
      await fetch(`${ADMIN_URL}/api/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "order_placed",
          userId,
          items: items.map(i => ({ product_id: i.product_id, name: i.product_name, qty: i.qty })),
          subtotal, discount, total
        })
      });
    } catch (e) {
      console.warn("Admin notify failed (order_placed):", e);
    }

    // Create a payment session using your existing API
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://grandlnik-website.vercel.app";
    const res = await fetch(`${baseUrl}/api/create-payment-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: total,
        currency: "PHP",
        user_item_id: userItemIds[0],               // primary
        product_name: "Cart Checkout",
        success_url: `${baseUrl}/profile/order`,
        cancel_url: `${baseUrl}/profile/cart`,
        payment_type: "order",
        payment_method: "paymongo",
        // Attach all item ids; webhooks must handle array/CSV
        metadata: { user_item_ids: userItemIds.join(",") }
      })
    });

    const session = await res.json();
    if (!res.ok) return NextResponse.json({ error: session?.error || "Failed to create payment session" }, { status: 500 });

    return NextResponse.json({
      success: true,
      checkoutUrl: session.checkoutUrl,
      user_item_ids: userItemIds,
      totals: { subtotal, discount, total }
    });
  } catch (e: any) {
    console.error("Checkout error:", e);
    return NextResponse.json({ error: e?.message || "Checkout failed" }, { status: 500 });
  }
}