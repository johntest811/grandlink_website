import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type ChangeOrderBody = {
  user_item_id: string;
  delivery_method: "delivery" | "pickup";
  delivery_address_id?: string | null;
  branch?: string | null;
};

function normalizeDeliveryMethod(v: unknown): "delivery" | "pickup" | null {
  if (v === "delivery" || v === "pickup") return v;
  return null;
}

function canChange(item: { status?: string; order_status?: string; order_progress?: string }) {
  const s = String(item.order_status || item.order_progress || item.status || "");
  // Only allow changes before production starts.
  const blocked = new Set([
    "in_production",
    "quality_check",
    "start_packaging",
    "packaging",
    "ready_for_delivery",
    "out_for_delivery",
    "completed",
    "cancelled",
    "pending_cancellation",
  ]);
  return !blocked.has(s);
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const body = (await req.json()) as Partial<ChangeOrderBody>;
    const userItemId = String(body.user_item_id || "").trim();
    const deliveryMethod = normalizeDeliveryMethod(body.delivery_method);
    const deliveryAddressId = body.delivery_address_id ?? null;
    const branch = (body.branch ?? "").toString().trim() || null;

    if (!userItemId) return NextResponse.json({ error: "user_item_id is required" }, { status: 400 });
    if (!deliveryMethod) return NextResponse.json({ error: "delivery_method must be 'delivery' or 'pickup'" }, { status: 400 });

    if (deliveryMethod === "delivery" && !deliveryAddressId) {
      return NextResponse.json({ error: "delivery_address_id is required for delivery" }, { status: 400 });
    }
    if (deliveryMethod === "pickup" && !branch) {
      return NextResponse.json({ error: "branch is required for pickup" }, { status: 400 });
    }

    const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userWrap, error: userErr } = await supabaseUser.auth.getUser(token);
    const userId = userWrap?.user?.id || null;
    if (userErr || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: item, error: itemErr } = await supabaseAdmin
      .from("user_items")
      .select("id,user_id,status,order_status,meta,delivery_address_id")
      .eq("id", userItemId)
      .maybeSingle();

    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
    if (!item) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (item.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!canChange(item)) {
      return NextResponse.json({ error: "Order can no longer be changed at this stage" }, { status: 400 });
    }

    const meta = (item as { meta?: unknown }).meta;
    const metaObj = (meta && typeof meta === "object" && !Array.isArray(meta)) ? (meta as Record<string, unknown>) : {};

    const nextMeta: Record<string, unknown> = {
      ...metaObj,
      delivery_method: deliveryMethod,
      selected_branch: deliveryMethod === "pickup" ? branch : null,
      branch: deliveryMethod === "pickup" ? branch : null,
    };

    const updates: Record<string, unknown> = {
      meta: nextMeta,
      updated_at: new Date().toISOString(),
      delivery_address_id: deliveryMethod === "delivery" ? deliveryAddressId : null,
    };

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("user_items")
      .update(updates)
      .eq("id", userItemId)
      .select("id,meta,delivery_address_id,updated_at")
      .single();

    if (upErr || !updated) return NextResponse.json({ error: upErr?.message || "Update failed" }, { status: 500 });

    return NextResponse.json({ ok: true, item: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
