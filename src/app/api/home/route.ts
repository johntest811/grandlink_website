import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  invalidateServerMemoryCacheByPrefix,
  invalidateServerMemoryCacheKey,
  readServerMemoryCache,
  writeServerMemoryCache,
} from "@/app/lib/serverMemoryCache";

const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPA_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

function getReadClient() {
  if (!SUPA_URL || !(SUPA_SERVICE_KEY || SUPA_ANON_KEY)) return null;
  return createClient(SUPA_URL, SUPA_SERVICE_KEY || SUPA_ANON_KEY || "");
}

function getWriteClient() {
  if (!SUPA_URL || !SUPA_SERVICE_KEY) return null;
  return createClient(SUPA_URL, SUPA_SERVICE_KEY);
}

const GET_CACHE_CONTROL = "public, max-age=120, s-maxage=600, stale-while-revalidate=3600";
const HOME_MEMORY_CACHE_KEY = "home:payload";
const HOME_MEMORY_CACHE_TTL_MS = 2 * 60 * 1000;

// GET -> return the home content (single row with slug = 'home')
export async function GET() {
  const cached = readServerMemoryCache<any>(HOME_MEMORY_CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  const supabase = getReadClient();
  if (!supabase) {
    const payload = { content: {}, updated_at: null, newest_products: [] };
    writeServerMemoryCache(HOME_MEMORY_CACHE_KEY, payload, HOME_MEMORY_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }

  try {
    const bySlug = await supabase
      .from("home_content")
      .select("content,updated_at")
      .eq("slug", "home")
      .limit(1)
      .maybeSingle();

    const homeData = bySlug.data
      ? bySlug.data
      : (
          await supabase
            .from("home_content")
            .select("content,updated_at")
            .eq("id", SINGLETON_ID)
            .limit(1)
            .maybeSingle()
        ).data || { content: {}, updated_at: null };

    const newestProductsRes = await supabase
      .from("products")
      .select("id, name, fullproductname, description, price, images, image1, image2, image3, image4, image5, created_at")
      .order("created_at", { ascending: false })
      .limit(4);

    const normalizedProducts = (newestProductsRes.data || []).map((p: any) => {
      const arrFromCols = [p.image1, p.image2, p.image3, p.image4, p.image5].filter(Boolean);
      const imagesArray = Array.isArray(p.images) && p.images.length ? p.images : arrFromCols;
      const firstImage = imagesArray && imagesArray.length ? imagesArray[0] : undefined;

      const productCode = p.name ?? p.code ?? `GE-${String(p.id || "").slice(0, 6)}`;
      const productName = p.fullproductname ?? p.product_name ?? p.productName ?? p.name;

      return {
        id: p.id,
        title: productCode,
        name: productName,
        code: productCode,
        description: p.description,
        price: p.price,
        images: imagesArray,
        image: firstImage,
        created_at: p.created_at,
      };
    });

    const payload = {
      content: homeData.content || {},
      updated_at: homeData.updated_at || null,
      newest_products: normalizedProducts,
    };
    writeServerMemoryCache(HOME_MEMORY_CACHE_KEY, payload, HOME_MEMORY_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  } catch (error: any) {
    console.error("GET /api/home failed", error);
    const payload = { content: {}, updated_at: null, newest_products: [] };
    writeServerMemoryCache(HOME_MEMORY_CACHE_KEY, payload, HOME_MEMORY_CACHE_TTL_MS);
    return NextResponse.json(payload, { headers: { "Cache-Control": GET_CACHE_CONTROL } });
  }
}

// PUT -> update the content (expects JSON body with new content object)
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const supabase = getWriteClient();
    if (!supabase) {
      return NextResponse.json(
        { error: "Server write client not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)" },
        { status: 500 }
      );
    }

    const payload = { content: body, updated_at: new Date().toISOString() };

    const byId = await supabase
      .from("home_content")
      .upsert({ id: SINGLETON_ID, ...payload }, { onConflict: "id" })
      .select("content,updated_at")
      .maybeSingle();

    if (!byId.error && byId.data) {
      invalidateServerMemoryCacheKey(HOME_MEMORY_CACHE_KEY);
      // Home content can include product defaults (e.g., skybox defaults) used by /api/products.
      invalidateServerMemoryCacheByPrefix("products:");
      return NextResponse.json(byId.data, { headers: { "Cache-Control": "no-store" } });
    }

    const { data, error } = await supabase
      .from("home_content")
      .upsert({ slug: "home", ...payload }, { onConflict: "slug" })
      .select("content,updated_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invalidateServerMemoryCacheKey(HOME_MEMORY_CACHE_KEY);
    invalidateServerMemoryCacheByPrefix("products:");
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown" }, { status: 500 });
  }
}