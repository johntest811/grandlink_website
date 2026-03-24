import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SINGLETON_ID = "00000000-0000-0000-0000-000000000001";
const GET_CACHE_CONTROL = "public, max-age=120, s-maxage=600, stale-while-revalidate=3600";

function getReadClient() {
  if (!SUPABASE_URL || !(SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY)) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY || "");
}

function getWriteClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function GET() {
  const supabase = getReadClient();
  if (!supabase) {
    return NextResponse.json(
      { content: {}, updated_at: null },
      { headers: { "Cache-Control": GET_CACHE_CONTROL } }
    );
  }

  try {
    const bySlug = await supabase
      .from("downloads_content")
      .select("content,updated_at")
      .eq("slug", "downloads")
      .limit(1)
      .maybeSingle();

    if (bySlug.data) {
      return NextResponse.json(bySlug.data, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
    }

    const byId = await supabase
      .from("downloads_content")
      .select("content,updated_at")
      .eq("id", SINGLETON_ID)
      .limit(1)
      .maybeSingle();

    if (byId.data) {
      return NextResponse.json(byId.data, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
    }

    return NextResponse.json(
      { content: {}, updated_at: null },
      { headers: { "Cache-Control": GET_CACHE_CONTROL } }
    );
  } catch (error: any) {
    console.error("GET /api/downloads failed", error);
    return NextResponse.json(
      { content: {}, updated_at: null },
      { headers: { "Cache-Control": GET_CACHE_CONTROL } }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const supabase = getWriteClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Server write client not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)" },
        { status: 500 }
      );
    }

    const content = body?.content ?? body;
    const payload = { content, updated_at: new Date().toISOString() };

    const byId = await supabase
      .from("downloads_content")
      .upsert({ id: SINGLETON_ID, slug: "downloads", ...payload }, { onConflict: "id" })
      .select("content,updated_at")
      .maybeSingle();

    if (!byId.error && byId.data) {
      return NextResponse.json(byId.data, { headers: { "Cache-Control": "no-store" } });
    }

    const bySlug = await supabase
      .from("downloads_content")
      .upsert({ slug: "downloads", ...payload }, { onConflict: "slug" })
      .select("content,updated_at")
      .maybeSingle();

    if (bySlug.error) {
      return NextResponse.json({ error: bySlug.error.message }, { status: 500 });
    }

    return NextResponse.json(bySlug.data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown" }, { status: 500 });
  }
}
