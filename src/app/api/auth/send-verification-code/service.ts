import nodemailer from "nodemailer";
import { createServerClient } from "@/app/Clients/Supabase/SupabaseClients";

type VerificationEntry = {
  code: string;
  expiresAt: number;
  lastSentAt: number;
};

// Store verification codes temporarily (in production, use Redis or database)
// Also track lastSentAt to avoid duplicate emails being sent rapidly.
const verificationCodes = new Map<string, VerificationEntry>();

type DbCodeRow = {
  email: string;
  code: string;
  expires_at: string;
  last_sent_at: string | null;
};

const VERIFICATION_TABLE = "login_verification_codes";

async function getDbRow(email: string) {
  const supabaseAdmin = createServerClient();
  const { data, error } = await supabaseAdmin
    .from(VERIFICATION_TABLE)
    .select("email, code, expires_at, last_sent_at")
    .eq("email", email)
    .maybeSingle();

  if (error) throw error;
  return (data as DbCodeRow | null) ?? null;
}

async function upsertDbRow(email: string, code: string, expiresAtMs: number) {
  const supabaseAdmin = createServerClient();
  const expiresAtIso = new Date(expiresAtMs).toISOString();
  const nowIso = new Date().toISOString();

  const { error } = await supabaseAdmin.from(VERIFICATION_TABLE).upsert(
    {
      email,
      code,
      expires_at: expiresAtIso,
      last_sent_at: nowIso,
    },
    { onConflict: "email" }
  );

  if (error) throw error;
}

async function deleteDbRow(email: string) {
  const supabaseAdmin = createServerClient();
  const { error } = await supabaseAdmin.from(VERIFICATION_TABLE).delete().eq("email", email);
  if (error) throw error;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationCode(emailRaw: string, resend: boolean) {
  const email = normalizeEmail(emailRaw);
  if (!email) {
    return { ok: false as const, status: 400, error: "Invalid email" };
  }

  // Prefer DB-backed codes (reliable across reloads/instances). Fallback to in-memory if DB isn't available.
  let existingDb: DbCodeRow | null = null;
  try {
    existingDb = await getDbRow(email);
  } catch {
    existingDb = null;
  }

  const existingMem = verificationCodes.get(email);

  const existing = existingDb
    ? {
        code: existingDb.code,
        expiresAt: Date.parse(existingDb.expires_at),
        lastSentAt: existingDb.last_sent_at ? Date.parse(existingDb.last_sent_at) : 0,
      }
    : existingMem;

  // If a valid code already exists and this isn't an explicit resend request,
  // don't send another email. This prevents duplicate emails in the inbox.
  if (existing && existing.expiresAt > Date.now() && !resend) {
    return { ok: true as const, status: 200, message: "Verification code already sent" };
  }

  // If resend is requested, rate-limit resends to once every 60 seconds.
  if (existing && existing.expiresAt > Date.now() && resend) {
    const now = Date.now();
    const elapsed = now - (existing.lastSentAt || 0);
    if (elapsed < 60_000) {
      const remain = Math.ceil((60_000 - elapsed) / 1000);
      return { ok: true as const, status: 200, message: `Please wait ${remain}s before resending` };
    }
  }

  // Generate a new code when missing/expired; otherwise reuse the existing code
  const code = existing && existing.expiresAt > Date.now() ? existing.code : generateVerificationCode();

  // Persist metadata (reuse code if still valid, extend/refresh TTL and lastSentAt)
  const expiresAtMs = Date.now() + 10 * 60 * 1000;
  verificationCodes.set(email, {
    code,
    expiresAt: expiresAtMs,
    lastSentAt: Date.now(),
  });

  // Best-effort write-through to DB
  try {
    await upsertDbRow(email, code, expiresAtMs);
  } catch {
    // ignore; in-memory fallback still works in dev
  }

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
    // If sending fails, keep the code stored so a resend can reuse it.
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

  // Prefer DB-backed verification (reliable across reloads/instances).
  try {
    const row = await getDbRow(email);
    if (row) {
      const expiresAtMs = Date.parse(row.expires_at);
      if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
        await deleteDbRow(email);
        verificationCodes.delete(email);
        return { ok: false as const, status: 400, error: "Verification code expired" };
      }

      if (row.code !== code) {
        return { ok: false as const, status: 400, error: "Invalid verification code" };
      }

      await deleteDbRow(email);
      verificationCodes.delete(email);
      return { ok: true as const, status: 200, message: "Code verified successfully" };
    }
  } catch {
    // ignore DB errors and fall back to memory
  }

  // Fallback: in-memory verification (dev only)
  const stored = verificationCodes.get(email);
  if (!stored) {
    return { ok: false as const, status: 404, error: "No verification code found" };
  }

  if (Date.now() > stored.expiresAt) {
    verificationCodes.delete(email);
    return { ok: false as const, status: 400, error: "Verification code expired" };
  }

  if (stored.code !== code) {
    return { ok: false as const, status: 400, error: "Invalid verification code" };
  }

  verificationCodes.delete(email);
  return { ok: true as const, status: 200, message: "Code verified successfully" };
}
