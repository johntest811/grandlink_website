import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { invalidateServerMemoryCacheKey, readServerMemoryCache, writeServerMemoryCache } from "@/app/lib/serverMemoryCache";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only

if (!SUPA_URL || !SUPA_KEY) {
  console.warn("Supabase server env missing for API /api/services-page");
}

const supabase = createClient(SUPA_URL || "", SUPA_KEY || "");
const GET_CACHE_CONTROL = "public, max-age=120, s-maxage=600, stale-while-revalidate=3600";
const SERVICES_MEMORY_CACHE_KEY = "services-page:payload";
const SERVICES_MEMORY_CACHE_TTL_MS = 2 * 60 * 1000;

// GET -> return the services page content (single row with slug = 'services')
export async function GET() {
  const cached = readServerMemoryCache<any>(SERVICES_MEMORY_CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  const { data, error } = await supabase
    .from("services_page_content")
    .select("content,updated_at")
    .eq("slug", "services")
    .limit(1)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  writeServerMemoryCache(SERVICES_MEMORY_CACHE_KEY, data, SERVICES_MEMORY_CACHE_TTL_MS);
  return NextResponse.json(data, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
}

// PUT -> update the page content (expects JSON body with new content object)
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("services_page_content")
      .upsert(
        { slug: "services", content: body, updated_at: new Date().toISOString() },
        { onConflict: "slug" }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateServerMemoryCacheKey(SERVICES_MEMORY_CACHE_KEY);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
