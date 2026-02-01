import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only

if (!SUPA_URL || !SUPA_KEY) {
  console.warn("Supabase server env missing for API /api/services-page");
}

const supabase = createClient(SUPA_URL || "", SUPA_KEY || "");

// GET -> return the services page content (single row with slug = 'services')
export async function GET() {
  const { data, error } = await supabase
    .from("services_page_content")
    .select("content,updated_at")
    .eq("slug", "services")
    .limit(1)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
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
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
