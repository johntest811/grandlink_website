import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureProductionWorkflow } from "@/app/lib/productionWorkflow";
import { readServerMemoryCache, writeServerMemoryCache } from "@/app/lib/serverMemoryCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ORDER_PROGRESS_CACHE_CONTROL = "public, max-age=10, s-maxage=30, stale-while-revalidate=120";
const ORDER_PROGRESS_MEMORY_CACHE_PREFIX = "order-progress:";
const ORDER_PROGRESS_MEMORY_CACHE_TTL_MS = 20_000;

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type OrderRow = {
  id: string;
  product_id: string;
  quantity: number;
  status: string;
  order_status?: string | null;
  order_progress?: string | null;
  created_at: string;
  updated_at?: string | null;
  progress_history?: any[] | null;
  meta?: Record<string, unknown> | null;
  estimated_delivery_date?: string | null;
};

type ProductRow = {
  id: string;
  name?: string | null;
  images?: string[] | null;
  image1?: string | null;
  image2?: string | null;
};

const statusLabelMap: Record<string, string> = {
  pending_payment: "Awaiting Payment",
  reserved: "Payment Confirmed",
  pending_balance_payment: "Pending Balance Payment",
  approved: "Approved",
  in_production: "In Production",
  quality_check: "Quality Check",
  packaging: "Packaging",
  ready_for_delivery: "Ready for Delivery",
  out_for_delivery: "Out for Delivery",
  completed: "Completed",
  pending_cancellation: "Pending Cancellation",
  cancelled: "Cancelled",
};

const timelineSteps = [
  "pending_payment",
  "reserved",
  "approved",
  "in_production",
  "quality_check",
  "packaging",
  "ready_for_delivery",
  "out_for_delivery",
  "completed",
] as const;

function normalizeTimelineStatus(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "approved";
  if (normalized === "accepted" || normalized === "pending_acceptance") return "approved";
  if (normalized === "start_packaging") return "packaging";
  if (normalized === "quality_checking") return "quality_check";
  if (normalized === "awaiting_payment") return "pending_payment";
  if (normalized === "payment_confirmed") return "reserved";
  if (normalized === "delivered") return "completed";
  if (normalized === "balance_due") return "pending_balance_payment";
  return normalized;
}

function toStatusLabel(status: string): string {
  return statusLabelMap[status] || status.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function parseHistory(order: OrderRow) {
  const meta = order.meta && typeof order.meta === "object" ? order.meta : {};
  const topLevel = Array.isArray(order.progress_history) ? order.progress_history : [];
  const metaLevel = Array.isArray((meta as any).progress_history) ? ((meta as any).progress_history as any[]) : [];
  const source = topLevel.length ? topLevel : metaLevel;

  return source
    .map((entry) => {
      const status = normalizeTimelineStatus(entry?.status);
      const updatedAt = typeof entry?.updated_at === "string" ? entry.updated_at : null;
      return {
        status,
        label: toStatusLabel(status),
        updated_at: updatedAt,
      };
    })
    .filter((entry) => entry.status);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await ctx.params;
    const resolvedOrderId = decodeURIComponent(String(orderId || "")).trim();

    if (!resolvedOrderId) {
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 });
    }

    if (resolvedOrderId.length > 128) {
      return NextResponse.json({ error: "Invalid Order ID" }, { status: 400 });
    }

    // Avoid unnecessary DB work for obviously invalid order id patterns.
    if (!/^[A-Za-z0-9-]+$/.test(resolvedOrderId)) {
      return NextResponse.json({ error: "Invalid Order ID" }, { status: 400 });
    }

    const cacheKey = `${ORDER_PROGRESS_MEMORY_CACHE_PREFIX}${resolvedOrderId}`;
    const cached = readServerMemoryCache<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        status: 200,
        headers: { "Cache-Control": ORDER_PROGRESS_CACHE_CONTROL },
      });
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Server configuration missing for order tracking" }, { status: 500 });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("user_items")
      .select(
        "id,product_id,quantity,status,order_status,order_progress,created_at,updated_at,progress_history,meta,estimated_delivery_date"
      )
      .eq("id", resolvedOrderId)
      .maybeSingle<OrderRow>();

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id,name,images,image1,image2")
      .eq("id", order.product_id)
      .maybeSingle<ProductRow>();

    const currentStatus = normalizeTimelineStatus(order.order_status || order.order_progress || order.status);
    const meta = order.meta && typeof order.meta === "object" ? order.meta : {};

    const cancellationLike = new Set(["cancelled", "pending_cancellation"]);
    let timelineStatus = currentStatus;
    if (cancellationLike.has(currentStatus)) {
      const previous = normalizeTimelineStatus((meta as any).cancel_prev_stage || "approved");
      timelineStatus = cancellationLike.has(previous) ? "approved" : previous;
    }

    const reachedIndex = Math.max(0, timelineSteps.indexOf(timelineStatus as (typeof timelineSteps)[number]));
    const history = parseHistory(order);

    const timeline = timelineSteps.map((stepKey, index) => {
      const historyMatch = history.find((entry) => entry.status === stepKey);
      return {
        key: stepKey,
        label: toStatusLabel(stepKey),
        reached: index <= reachedIndex,
        current: stepKey === timelineStatus && !cancellationLike.has(currentStatus),
        updated_at: historyMatch?.updated_at || null,
      };
    });

    const hasWorkflow =
      typeof (meta as any).production_workflow === "object" && (meta as any).production_workflow !== null;
    const workflowStages = hasWorkflow
      ? ensureProductionWorkflow((meta as any).production_workflow).stage_plans.map((stage) => ({
          key: stage.key,
          label: stage.label,
          status: stage.status,
          approved_at: stage.approved_at || null,
          last_submission_at: stage.last_submission_at || null,
        }))
      : null;

    const response = {
      order: {
        id: order.id,
        quantity: Number(order.quantity || 1),
        status: currentStatus,
        statusLabel: toStatusLabel(currentStatus),
        createdAt: order.created_at,
        updatedAt: order.updated_at || order.created_at,
        estimatedDeliveryDate: order.estimated_delivery_date || null,
      },
      product: {
        id: order.product_id,
        name: product?.name || "Product",
        imageUrl: product?.images?.[0] || product?.image1 || product?.image2 || "/no-image.png",
      },
      timeline,
      progressHistory: history,
      productionStages: workflowStages,
    };

    writeServerMemoryCache(cacheKey, response, ORDER_PROGRESS_MEMORY_CACHE_TTL_MS);

    return NextResponse.json(response, {
      status: 200,
      headers: {
        "Cache-Control": ORDER_PROGRESS_CACHE_CONTROL,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
