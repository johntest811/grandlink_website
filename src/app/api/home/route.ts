import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

// GET -> return the home content (single row with slug = 'home')
export async function GET() {
  const supabase = getReadClient();
  if (!supabase) {
    return NextResponse.json({ content: {}, updated_at: null });
  }

  try {
    const bySlug = await supabase
      .from("home_content")
      .select("content,updated_at")
      .eq("slug", "home")
      .limit(1)
      .maybeSingle();

    if (bySlug.data) {
      return NextResponse.json(bySlug.data);
    }

    const byId = await supabase
      .from("home_content")
      .select("content,updated_at")
      .eq("id", SINGLETON_ID)
      .limit(1)
      .maybeSingle();

    if (byId.data) {
      return NextResponse.json(byId.data);
    }

    return NextResponse.json({ content: {}, updated_at: null });
  } catch (error: any) {
    console.error("GET /api/home failed", error);
    return NextResponse.json({ content: {}, updated_at: null });
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
      return NextResponse.json(byId.data);
    }

    const { data, error } = await supabase
      .from("home_content")
      .upsert({ slug: "home", ...payload }, { onConflict: "slug" })
      .select("content,updated_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "unknown" }, { status: 500 });
  }
}