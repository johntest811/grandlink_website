import { NextResponse } from "next/server";
import { getChatAdminClient, getThreadByToken } from "../_server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = (searchParams.get("token") || "").trim();
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const thread = await getThreadByToken(token);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const supabase = getChatAdminClient();
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      thread: {
        id: thread.id,
        status: thread.status,
        accepted_at: thread.accepted_at,
        resolved_at: thread.resolved_at,
      },
      messages: data ?? [],
    });
  } catch (e: any) {
    console.error("GET /api/chat/messages error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      token?: string;
      senderType?: "visitor" | "user" | "admin";
      senderName?: string;
      senderEmail?: string;
      message?: string;
      imageUrl?: string;
    };

    const token = (body.token || "").trim();
    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const thread = await getThreadByToken(token);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (thread.status === "resolved") {
      return NextResponse.json(
        { error: "This chat is resolved. Start a new chat." },
        { status: 409 }
      );
    }

    const sender_type = body.senderType === "user" ? "user" : "visitor";
    const sender_name = (body.senderName || thread.visitor_name || "Guest").trim();
    const sender_email = (body.senderEmail || thread.visitor_email || "").trim();

    const messageText = (body.message || "").trim();
    const imageUrl = (body.imageUrl || "").trim();

    if (!messageText && !imageUrl) {
      return NextResponse.json(
        { error: "Message or image is required" },
        { status: 400 }
      );
    }

    const supabase = getChatAdminClient();

    const { error: insertErr } = await supabase.from("chat_messages").insert({
      thread_id: thread.id,
      sender_type,
      sender_name,
      sender_email,
      body: messageText || null,
      image_url: imageUrl || null,
      read_by_admin: false,
      read_by_user: true,
    });

    if (insertErr) throw insertErr;

    await supabase
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", thread.id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("POST /api/chat/messages error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
