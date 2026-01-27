import { NextResponse } from "next/server";
import { getChatAdminClient, getThreadByToken } from "../_server";

export const runtime = "nodejs";

const BUCKET = "chat-uploads";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = String(form.get("token") || "").trim();
    const file = form.get("file") as File | null;

    if (!token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const thread = await getThreadByToken(token);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const supabase = getChatAdminClient();

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${thread.id}/${Date.now()}_${safeName}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({
      ok: true,
      bucket: BUCKET,
      path,
      url: data.publicUrl,
    });
  } catch (e: any) {
    console.error("POST /api/chat/upload error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
