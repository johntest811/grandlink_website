import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../_server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  blogId?: string;
  userId?: string | null;
  userAgent?: string | null;
};

function looksLikeUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isUniqueViolation(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "23505";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const blogId = String(body.blogId || "").trim();

    if (!looksLikeUuid(blogId)) {
      return NextResponse.json({ error: "blogId is required" }, { status: 400 });
    }

    const userId = body.userId ? String(body.userId) : null;
    if (userId && !looksLikeUuid(userId)) {
      return NextResponse.json({ error: "userId must be a UUID" }, { status: 400 });
    }

    // Prefer userId if present. For logged-out visitors, generate a fresh server-side
    // visitor id per request so every anonymous page view is counted.
    const identity = userId
      ? { userId, visitorId: null as string | null }
      : { userId: null as string | null, visitorId: randomUUID() };

    const supabase = getSupabaseAdmin();

    const userAgent = body.userAgent || req.headers.get("user-agent") || null;

    if (identity.userId) {
      const { error } = await supabase.from("blog_views").insert({
        blog_id: blogId,
        user_id: identity.userId,
        visitor_id: null,
        user_agent: userAgent,
      });

      if (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const { error: fallbackError } = await supabase.from("blog_views").insert({
          blog_id: blogId,
          user_id: null,
          visitor_id: randomUUID(),
          user_agent: userAgent,
        });
        if (fallbackError) throw fallbackError;
      }
    } else {
      const { error } = await supabase.from("blog_views").insert({
        blog_id: blogId,
        user_id: null,
        visitor_id: identity.visitorId,
        user_agent: userAgent,
      });
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
