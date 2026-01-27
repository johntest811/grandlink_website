import { NextResponse } from "next/server";
import { getChatAdminClient } from "../_server";

export async function POST(req: Request) {
  try {
    const { name, email, userId } = (await req.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
      userId?: string;
    };

    const visitor_name = (name || "").trim();
    const visitor_email = (email || "").trim().toLowerCase();

    if (!userId) {
      if (!visitor_name) {
        return NextResponse.json(
          { error: "Name is required" },
          { status: 400 }
        );
      }
      if (!visitor_email || !visitor_email.includes("@")) {
        return NextResponse.json(
          { error: "Valid Gmail/email is required" },
          { status: 400 }
        );
      }
    }

    const supabase = getChatAdminClient();

    // Reuse an existing open thread for the same identity (best-effort)
    if (userId) {
      const { data: existing } = await supabase
        .from("chat_threads")
        .select("id, access_token, status")
        .eq("user_id", userId)
        .in("status", ["pending", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({
          threadId: existing.id,
          token: existing.access_token,
          status: existing.status,
        });
      }
    } else {
      const { data: existing } = await supabase
        .from("chat_threads")
        .select("id, access_token, status")
        .eq("visitor_email", visitor_email)
        .in("status", ["pending", "active"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({
          threadId: existing.id,
          token: existing.access_token,
          status: existing.status,
        });
      }
    }

    const { data, error } = await supabase
      .from("chat_threads")
      .insert({
        visitor_name: userId ? null : visitor_name,
        visitor_email: userId ? null : visitor_email,
        user_id: userId ?? null,
        status: "pending",
        last_message_at: new Date().toISOString(),
      })
      .select("id, access_token, status")
      .single();

    if (error) throw error;

    return NextResponse.json({
      threadId: data.id,
      token: data.access_token,
      status: data.status,
    });
  } catch (e: any) {
    console.error("POST /api/chat/threads error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = (searchParams.get("token") || "").trim();
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const supabase = getChatAdminClient();
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id, status, created_at, accepted_at, resolved_at, last_message_at")
      .eq("access_token", token)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({ thread: data });
  } catch (e: any) {
    console.error("GET /api/chat/threads error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
