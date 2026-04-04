import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readServerMemoryCache, writeServerMemoryCache } from "@/app/lib/serverMemoryCache";

const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const GET_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const REVIEWS_CACHE_TTL_MS = 60_000;

function getReadClient() {
  if (!SUPA_URL || !SUPA_ANON_KEY) return null;
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "Missing productId" }, { status: 400 });
  }

  const cacheKey = `product-reviews:${productId}`;
  const cached = readServerMemoryCache<any>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  const supabase = getReadClient();
  if (!supabase) {
    const payload = { reviews: [] };
    writeServerMemoryCache(cacheKey, payload, REVIEWS_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  try {
    const { data, error } = await supabase
      .from("product_reviews")
      .select("id, product_id, user_id, rating, comment, created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const payload = { reviews: data || [] };
    writeServerMemoryCache(cacheKey, payload, REVIEWS_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown" }, { status: 500 });
  }
}
