import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  let query = supabase.from("products").select("*");
  if (id) query = query.eq("id", id);
  const { data, error } = id ? await query.single() : await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });

  let globalDefaults: Record<string, string | null> = {};
  if (supabaseServer) {
    const { data: contentRow } = await supabaseServer
      .from("home_content")
      .select("content")
      .eq("id", SINGLETON_ID)
      .limit(1)
      .maybeSingle();
    globalDefaults = (contentRow?.content as any)?.productSkyboxDefaults || {};
  }

  if (Array.isArray(data)) {
    const merged = data.map((product) => ({
      ...product,
      custom_skyboxes: product?.skyboxes || null,
      skyboxes: mergeEffectiveSkyboxes(product?.skyboxes, globalDefaults),
    }));
    return new Response(JSON.stringify(merged), { status: 200 });
  }

  return new Response(
    JSON.stringify({
      ...data,
      custom_skyboxes: (data as any)?.skyboxes || null,
      skyboxes: mergeEffectiveSkyboxes((data as any)?.skyboxes, globalDefaults),
    }),
    { status: 200 }
  );
}
