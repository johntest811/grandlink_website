import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mergeSkyboxes, normalizeSkyboxes } from "@/app/lib/productSkyboxes";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const HOME_CONTENT_SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

async function getSharedSkyboxDefaults() {
  const byId = await supabase
    .from("home_content")
    .select("content")
    .eq("id", HOME_CONTENT_SINGLETON_ID)
    .limit(1)
    .maybeSingle<{ content?: Record<string, any> | null }>();

  if (!byId.error && byId.data?.content) {
    return normalizeSkyboxes(byId.data.content.productSkyboxDefaults);
  }

  const bySlug = await supabase
    .from("home_content")
    .select("content")
    .eq("slug", "home")
    .limit(1)
    .maybeSingle<{ content?: Record<string, any> | null }>();

  if (!bySlug.error && bySlug.data?.content) {
    return normalizeSkyboxes(bySlug.data.content.productSkyboxDefaults);
  }

  return {};
}

function withEffectiveSkyboxes(product: any, sharedSkyboxes: Record<string, string | null>) {
  const productSkyboxes = normalizeSkyboxes(product?.skyboxes);
  return {
    ...product,
    effective_skyboxes: mergeSkyboxes(productSkyboxes, sharedSkyboxes),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  let query = supabase.from("products").select("*");
  if (id) query = query.eq("id", id);
  const { data, error } = id ? await query.single() : await query;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  const sharedSkyboxes = await getSharedSkyboxDefaults();
  const payload = Array.isArray(data)
    ? data.map((item) => withEffectiveSkyboxes(item, sharedSkyboxes))
    : withEffectiveSkyboxes(data, sharedSkyboxes);
  return new Response(JSON.stringify(payload), { status: 200 });
}
