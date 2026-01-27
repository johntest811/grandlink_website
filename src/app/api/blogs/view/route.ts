import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  blogId?: string;
  userId?: string | null;
  visitorId?: string | null;
  userAgent?: string | null;
};

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const blogId = String(body.blogId || "").trim();

    if (!looksLikeUuid(blogId)) {
      return NextResponse.json({ error: "blogId is required" }, { status: 400 });
    }

    const userId = body.userId ? String(body.userId) : null;
    const visitorId = body.visitorId ? String(body.visitorId) : null;

    if (userId && !looksLikeUuid(userId)) {
      return NextResponse.json({ error: "userId must be a UUID" }, { status: 400 });
    }
    if (visitorId && !looksLikeUuid(visitorId)) {
      return NextResponse.json({ error: "visitorId must be a UUID" }, { status: 400 });
    }

    // Prefer userId if present.
    const identity = userId ? { userId, visitorId: null } : { userId: null, visitorId };

    if (!identity.userId && !identity.visitorId) {
      return NextResponse.json({ error: "userId or visitorId is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (identity.userId) {
      const { error } = await supabase.from("blog_views").upsert(
        {
          blog_id: blogId,
          user_id: identity.userId,
          visitor_id: null,
          user_agent: body.userAgent || null,
        },
        { onConflict: "blog_id,user_id", ignoreDuplicates: true }
      );
      if (error) throw error;
    } else {
      const { error } = await supabase.from("blog_views").upsert(
        {
          blog_id: blogId,
          user_id: null,
          visitor_id: identity.visitorId,
          user_agent: body.userAgent || null,
        },
        { onConflict: "blog_id,visitor_id", ignoreDuplicates: true }
      );
      if (error) throw error;
    }

    const { data, error: countErr } = await supabase
      .from("blog_view_counts")
      .select("blog_id, view_count")
      .eq("blog_id", blogId)
      .maybeSingle();

    if (countErr) throw countErr;

    return NextResponse.json({ ok: true, viewCount: Number((data as any)?.view_count || 0) });
  } catch (e: any) {
    console.error("POST /api/blogs/view error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
