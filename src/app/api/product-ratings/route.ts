import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readServerMemoryCache, writeServerMemoryCache } from "@/app/lib/serverMemoryCache";

const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const GET_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const RATINGS_CACHE_TTL_MS = 60_000;

function getReadClient() {
  if (!SUPA_URL || !SUPA_ANON_KEY) return null;
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseIdsParam(value: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // de-dupe preserving order
  return Array.from(new Set(parts));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ids = parseIdsParam(searchParams.get("ids"));

  if (!ids.length) {
    return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  }

  // Keep URL + query manageable.
  const limited = ids.slice(0, 50);
  const cacheKey = `product-ratings:${limited.slice().sort().join(",")}`;

  const cached = readServerMemoryCache<any>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  const supabase = getReadClient();
  if (!supabase) {
    const payload = { summaries: {} };
    writeServerMemoryCache(cacheKey, payload, RATINGS_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  try {
    const { data, error } = await supabase
      .from("product_reviews")
      .select("product_id,rating")
      .in("product_id", limited);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const summaries: Record<string, { count: number; average: number }> = {};
    for (const id of limited) {
      summaries[id] = { count: 0, average: 0 };
    }

    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};

    for (const row of data || []) {
      const pid = String((row as any).product_id || "");
      const rating = Number((row as any).rating || 0);
      if (!pid) continue;
      if (!Number.isFinite(rating)) continue;

      sums[pid] = (sums[pid] || 0) + rating;
      counts[pid] = (counts[pid] || 0) + 1;
    }

    for (const pid of Object.keys(counts)) {
      const count = counts[pid] || 0;
      const sum = sums[pid] || 0;
      summaries[pid] = {
        count,
        average: count ? sum / count : 0,
      };
    }

    const payload = { summaries };
    writeServerMemoryCache(cacheKey, payload, RATINGS_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown" }, { status: 500 });
  }
}
