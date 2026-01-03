import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendVerificationCode } from "../send-verification-code/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ error: "missing or invalid credentials" }, { status: 400 });
    }

    if (!SUPA_URL || !SUPA_ANON) {
      return NextResponse.json({ error: "server not configured" }, { status: 500 });
    }

    // Server-side Supabase client without session persistence
    const supabaseServer = createClient(SUPA_URL, SUPA_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Verify email + password first (no session persisted server-side)
    const { data: signInData, error: signInErr } = await supabaseServer.auth.signInWithPassword({
      email,
      password,
    });

    if (signInErr) {
      // Common messages we want to surface clearly to the client
      const msg = signInErr.message?.toLowerCase?.() || "invalid credentials";
      if (msg.includes("email not confirmed") || msg.includes("confirmation")) {
        return NextResponse.json({ error: "Please confirm your email address before logging in." }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // 2) Immediately invalidate the server-side session (we only needed verification)
    await supabaseServer.auth.signOut();

    // 3) Send a verification code (from the dedicated login Gmail account)
    const codeResult = await sendVerificationCode(email, false);
    if (!codeResult.ok) {
      return NextResponse.json({ error: codeResult.error }, { status: codeResult.status });
    }

    return NextResponse.json({ success: true, message: codeResult.message });
  } catch (err: any) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
