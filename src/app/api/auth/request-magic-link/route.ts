import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendVerificationCode } from "../send-verification-code/service";
import { lookupGeo, sendLoginSecurityAlertEmail } from "../securityAlertEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const MAX_FAILED_ATTEMPTS = 3;
const LOCK_MINUTES = 1;

type LoginAttemptState = {
  failedCount: number;
  lockedUntil: number;
  lastIp?: string;
  lastUserAgent?: string;
  lastFailedAt: number;
};

// NOTE: in-memory only; on serverless this may not persist across instances.
const loginAttempts = new Map<string, LoginAttemptState>();

function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "";
}

function getKey(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ error: "missing or invalid credentials" }, { status: 400 });
    }

    if (!SUPA_URL || !SUPA_ANON) {
      return NextResponse.json({ error: "server not configured" }, { status: 500 });
    }

    const key = getKey(email);
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") || "";
    const now = Date.now();
    const state = loginAttempts.get(key);

    if (state && state.lockedUntil > now) {
      const secondsLeft = Math.ceil((state.lockedUntil - now) / 1000);
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${secondsLeft}s.` },
        { status: 429 }
      );
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

      // Record failed attempt + lock if needed
      const nextCount = (state?.failedCount || 0) + 1;
      const locked = nextCount >= MAX_FAILED_ATTEMPTS;
      const lockedUntil = locked ? now + LOCK_MINUTES * 60_000 : 0;

      loginAttempts.set(key, {
        failedCount: nextCount,
        lockedUntil,
        lastIp: ip,
        lastUserAgent: userAgent,
        lastFailedAt: now,
      });

      // Notify the account owner when lock threshold is reached
      if (locked) {
        const geo = await lookupGeo(ip);
        try {
          await sendLoginSecurityAlertEmail({
            toEmail: email,
            attempts: nextCount,
            ip,
            userAgent,
            geo,
            lockedMinutes: LOCK_MINUTES,
          });
        } catch {
          // Don't fail login response if email sending fails
        }

        return NextResponse.json(
          { error: "Too many failed login attempts. We emailed you security details." },
          { status: 429 }
        );
      }

      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Successful password verification => reset counters
    loginAttempts.delete(key);

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
