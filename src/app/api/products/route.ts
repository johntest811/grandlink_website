import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readServerMemoryCache, writeServerMemoryCache } from "@/app/lib/serverMemoryCache";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const supabaseServer = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  : null;

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";
const WEATHER_KEYS = ["sunny", "rainy", "night", "foggy"] as const;
const LIST_RESPONSE_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=1800";
const DETAIL_RESPONSE_CACHE_CONTROL = "public, max-age=120, s-maxage=600, stale-while-revalidate=1800";
const LIST_MEMORY_TTL_MS = 60 * 1000;
const DETAIL_MEMORY_TTL_MS = 2 * 60 * 1000;
const DEFAULTS_MEMORY_TTL_MS = 5 * 60 * 1000;

function normalizeSkyboxUrl(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mergeEffectiveSkyboxes(productSkyboxes: any, globalDefaults: any) {
  const safeProduct = productSkyboxes && typeof productSkyboxes === "object" ? productSkyboxes : {};
  const safeDefaults = globalDefaults && typeof globalDefaults === "object" ? globalDefaults : {};
  const legacyDefault = normalizeSkyboxUrl(safeProduct.default);
  const merged: Record<string, string | null> = legacyDefault ? { default: legacyDefault } : {};

  for (const weather of WEATHER_KEYS) {
    merged[weather] =
      normalizeSkyboxUrl(safeProduct[weather]) ||
      normalizeSkyboxUrl(safeDefaults[weather]) ||
      legacyDefault ||
      null;
  }

  return merged;
}

async function loadGlobalSkyboxDefaults() {
  const cacheKey = "products:globalSkyboxDefaults";
  const cached = readServerMemoryCache<Record<string, string | null>>(cacheKey);
  if (cached) return cached;

  if (!supabaseServer) {
    writeServerMemoryCache(cacheKey, {}, DEFAULTS_MEMORY_TTL_MS);
    return {};
  }

  const { data: contentRow } = await supabaseServer
    .from("home_content")
    .select("content")
    .eq("id", SINGLETON_ID)
    .limit(1)
    .maybeSingle();

  const defaults = ((contentRow?.content as any)?.productSkyboxDefaults || {}) as Record<string, string | null>;
  writeServerMemoryCache(cacheKey, defaults, DEFAULTS_MEMORY_TTL_MS);
  return defaults;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const responseCacheControl = id ? DETAIL_RESPONSE_CACHE_CONTROL : LIST_RESPONSE_CACHE_CONTROL;
  const memoryCacheKey = id ? `products:item:${id}` : "products:list";

  const cachedPayload = readServerMemoryCache<any>(memoryCacheKey);
  if (cachedPayload) {
    return NextResponse.json(cachedPayload, { headers: { "Cache-Control": responseCacheControl } });
  }

  let query = supabase.from("products").select("*");
  if (id) query = query.eq("id", id);
  const { data, error } = id ? await query.single() : await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

  const globalDefaults = await loadGlobalSkyboxDefaults();

  if (Array.isArray(data)) {
    const payload = data.map((product) => ({
      ...product,
      custom_skyboxes: product?.skyboxes || null,
      skyboxes: mergeEffectiveSkyboxes(product?.skyboxes, globalDefaults),
    }));

    writeServerMemoryCache(memoryCacheKey, payload, LIST_MEMORY_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": responseCacheControl } });
  }

  const payload = {
    ...data,
    custom_skyboxes: (data as any)?.skyboxes || null,
    skyboxes: mergeEffectiveSkyboxes((data as any)?.skyboxes, globalDefaults),
  };

  writeServerMemoryCache(memoryCacheKey, payload, DETAIL_MEMORY_TTL_MS);
  return NextResponse.json(payload, { headers: { "Cache-Control": responseCacheControl } });
}
