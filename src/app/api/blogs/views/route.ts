import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const idsRaw = String(searchParams.get("ids") || "").trim();

    const ids = idsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(looksLikeUuid)
      .slice(0, 250);

    if (ids.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("blog_view_counts")
      .select("blog_id, view_count")
      .in("blog_id", ids);

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const blogId = String((row as any).blog_id || "");
      counts[blogId] = Number((row as any).view_count || 0);
    }

    // Ensure missing ids show up as 0
    for (const id of ids) {
      if (counts[id] == null) counts[id] = 0;
    }

    return NextResponse.json({ counts });
  } catch (e: any) {
    console.error("GET /api/blogs/views error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
