import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resendInvoiceEmailForUserItem } from "@/app/lib/invoiceService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendBody = {
  userItemIds?: string[];
};

function getBearerToken(request: NextRequest) {
  const raw = request.headers.get("authorization") || "";
  if (!raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ error: "Missing access token" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as ResendBody;
    const rawIds = Array.isArray(body.userItemIds) ? body.userItemIds : [];
    const userItemIds = Array.from(
      new Set(rawIds.map((id) => String(id || "").trim()).filter(Boolean))
    );

    if (userItemIds.length === 0) {
      return NextResponse.json({ error: "No user item IDs provided" }, { status: 400 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    const { data: ownedItems, error: ownedError } = await supabaseAdmin
      .from("user_items")
      .select("id")
      .eq("user_id", user.id)
      .in("id", userItemIds);

    if (ownedError) {
      return NextResponse.json({ error: ownedError.message }, { status: 500 });
    }

    const ownedIds = new Set((ownedItems || []).map((item: any) => item.id as string));
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const id of userItemIds) {
      if (!ownedIds.has(id)) {
        results.push({ id, ok: false, error: "Item not found or unauthorized" });
        continue;
      }

      try {
        await resendInvoiceEmailForUserItem(id);
        results.push({ id, ok: true });
      } catch (error: any) {
        results.push({ id, ok: false, error: String(error?.message || error) });
      }
    }

    const okCount = results.filter((result) => result.ok).length;
    const failCount = results.length - okCount;

    return NextResponse.json({
      success: failCount === 0,
      okCount,
      failCount,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || error || "Failed to resend invoice") },
      { status: 500 }
    );
  }
}
