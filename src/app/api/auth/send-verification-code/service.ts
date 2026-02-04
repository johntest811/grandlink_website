import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const CODES_TABLE = "login_verification_codes";
const PEPPER = process.env.LOGIN_VERIFICATION_PEPPER || "";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashVerificationCode(email: string, code: string) {
  // Include email + pepper so hashes are not reusable across accounts.
  return crypto
    .createHash("sha256")
    .update(`${PEPPER}|${normalizeEmail(email)}|${String(code).trim()}`)
    .digest("hex");
}

type StoredCodeRow = {
  email: string;
  code_hash: string;
  expires_at: string;
  last_sent_at: string;
};

async function getStoredCode(email: string) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false as const, status: 500, error: "Server auth is not configured" };
  }

  const { data, error } = await supabaseAdmin
    .from(CODES_TABLE)
    .select("email, code_hash, expires_at, last_sent_at")
    .eq("email", email)
    .maybeSingle<StoredCodeRow>();

  if (error) {
    // If the table isn't created yet, fail with a helpful message.
    const msg = error.message || "Failed to read verification code";
    return {
      ok: false as const,
      status: 500,
      error:
        msg.includes("relation") && msg.includes("does not exist")
          ? `Missing database table '${CODES_TABLE}'. Create it in Supabase first.`
          : msg,
    };
  }

  return { ok: true as const, status: 200, row: data ?? null };
}

async function upsertStoredCode(email: string, codeHash: string, expiresAt: Date, lastSentAt: Date) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false as const, status: 500, error: "Server auth is not configured" };
  }

  const { error } = await supabaseAdmin
    .from(CODES_TABLE)
    .upsert(
      {
        email,
        code_hash: codeHash,
        expires_at: expiresAt.toISOString(),
        last_sent_at: lastSentAt.toISOString(),
        updated_at: new Date().toISOString(),
      } as {
        email: string;
        code_hash: string;
        expires_at: string;
        last_sent_at: string;
        updated_at: string;
      },
      { onConflict: "email" }
    );

  if (error) {
    const msg = error.message || "Failed to store verification code";
    return {
      ok: false as const,
      status: 500,
      error:
        msg.includes("column") && msg.includes("updated_at")
          ? `Database table '${CODES_TABLE}' is missing 'updated_at' column. Apply the provided SQL.`
          : msg,
    };
  }

  return { ok: true as const, status: 200 };
}

async function deleteStoredCode(email: string) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return { ok: false as const, status: 500, error: "Server auth is not configured" };
  }

  const { error } = await supabaseAdmin.from(CODES_TABLE).delete().eq("email", email);
  if (error) {
    return { ok: false as const, status: 500, error: "Failed to clear verification code" };
  }

  return { ok: true as const, status: 200 };
}

export async function sendVerificationCode(emailRaw: string, resend: boolean) {
  const email = normalizeEmail(emailRaw);
  if (!email) {
    return { ok: false as const, status: 400, error: "Invalid email" };
  }

  const existingRes = await getStoredCode(email);
  if (!existingRes.ok) return existingRes;
  const existing = existingRes.row;

  const now = Date.now();
  const existingExpiresAtMs = existing?.expires_at ? Date.parse(existing.expires_at) : 0;
  const existingLastSentAtMs = existing?.last_sent_at ? Date.parse(existing.last_sent_at) : 0;
  const existingValid = Boolean(existing && existingExpiresAtMs > now);

  // If a valid code already exists and this isn't an explicit resend request,
  // don't send another email.
  if (existingValid && !resend) {
    return { ok: true as const, status: 200, message: "Verification code already sent" };
  }

  // If resend is requested, rate-limit resends to once every 60 seconds.
  if (existingValid && resend) {
    const elapsed = now - (existingLastSentAtMs || 0);
    if (elapsed < 60_000) {
      const remain = Math.ceil((60_000 - elapsed) / 1000);
      return { ok: true as const, status: 200, message: `Please wait ${remain}s before resending` };
    }
  }

  // Always generate a new code when expired/missing; for valid+resend we also generate a new code.
  const code = generateVerificationCode();
  const codeHash = hashVerificationCode(email, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const lastSentAt = new Date();

  const persistRes = await upsertStoredCode(email, codeHash, expiresAt, lastSentAt);
  if (!persistRes.ok) return persistRes;

  // Send email with verification code
  const LOGIN_GMAIL_USER = process.env.LOGIN_GMAIL_USER || process.env.GMAIL_USER;
  const LOGIN_GMAIL_PASS = process.env.LOGIN_GMAIL_PASS || process.env.GMAIL_PASS;
  const LOGIN_GMAIL_FROM = process.env.LOGIN_GMAIL_FROM || process.env.GMAIL_FROM || LOGIN_GMAIL_USER;

  if (!LOGIN_GMAIL_USER || !LOGIN_GMAIL_PASS) {
    return { ok: false as const, status: 500, error: "Email is not configured on the server" };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: LOGIN_GMAIL_USER,
      pass: LOGIN_GMAIL_PASS,
    },
  });

  const mailOptions = {
    from: LOGIN_GMAIL_FROM,
    to: email,
    subject: "Your Verification Code - Grand East Glass and Aluminum",
    html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #8B1C1C 0%, #a83232 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .code-box { background: white; border: 2px dashed #8B1C1C; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
            .code { font-size: 32px; font-weight: bold; color: #8B1C1C; letter-spacing: 5px; font-family: 'Courier New', monospace; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🔒 Verification Code</h1>
              <p style="margin: 10px 0 0 0;">Grand East Glass and Aluminum</p>
            </div>
            <div class="content">
              <p>Hello,</p>
              <p>You requested to log in to your account. Please use the verification code below:</p>
              
              <div class="code-box">
                <div class="code">${code}</div>
                <p style="margin: 10px 0 0 0; color: #666; font-size: 14px;">This code will expire in 10 minutes</p>
              </div>

              <div class="warning">
                <strong>⚠️ Security Notice:</strong><br>
                If you didn't request this code, please ignore this email. Never share this code with anyone.
              </div>

              <p>Best regards,<br><strong>Grand East Glass and Aluminum Team</strong></p>
            </div>
            <div class="footer">
              <p>This is an automated message, please do not reply to this email.</p>
              <p>&copy; ${new Date().getFullYear()} Grand East Glass and Aluminum. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch {
    return { ok: false as const, status: 500, error: "Failed to send verification code" };
  }

  return { ok: true as const, status: 200, message: "Verification code sent to your email" };
}

export async function verifyVerificationCode(emailRaw: string, codeRaw: string) {
  const email = normalizeEmail(emailRaw);
  const code = String(codeRaw || "").trim();

  if (!email || !code) {
    return { ok: false as const, status: 400, error: "Email and code required" };
  }

  const existingRes = await getStoredCode(email);
  if (!existingRes.ok) return existingRes;
  const stored = existingRes.row;
  if (!stored) {
    return { ok: false as const, status: 404, error: "No verification code found" };
  }

  const expiresAtMs = Date.parse(stored.expires_at);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    await deleteStoredCode(email);
    return { ok: false as const, status: 400, error: "Verification code expired" };
  }

  const expectedHash = stored.code_hash;
  const actualHash = hashVerificationCode(email, code);
  if (expectedHash !== actualHash) {
    return { ok: false as const, status: 400, error: "Invalid verification code" };
  }

  await deleteStoredCode(email);
  return { ok: true as const, status: 200, message: "Code verified successfully" };
}

// Backward-compatible alias
export const verifyVerificationCodeAsync = verifyVerificationCode;
