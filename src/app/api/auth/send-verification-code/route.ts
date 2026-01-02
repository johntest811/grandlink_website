import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = 'nodejs';

// Store verification codes temporarily (in production, use Redis or database)
// Also track lastSentAt to avoid duplicate emails being sent rapidly
const verificationCodes = new Map<string, { code: string; expiresAt: number; lastSentAt: number }>();

// Generate a 6-digit verification code
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(req: Request) {
  try {
    const { email, resend } = await req.json();
    
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const key = email.toLowerCase();
    const existing = verificationCodes.get(key);

    // If a valid code already exists and this isn't an explicit resend request,
    // don't send another email. This prevents duplicate emails in the inbox.
    if (existing && existing.expiresAt > Date.now() && !resend) {
      return NextResponse.json({ success: true, message: "Verification code already sent" });
    }

    // If resend is requested, rate-limit resends to once every 60 seconds.
    if (existing && existing.expiresAt > Date.now() && resend) {
      const now = Date.now();
      const elapsed = now - (existing.lastSentAt || 0);
      if (elapsed < 60_000) {
        const remain = Math.ceil((60_000 - elapsed) / 1000);
        return NextResponse.json({ success: true, message: `Please wait ${remain}s before resending` });
      }
    }

    // Generate a new code when missing/expired; otherwise reuse the existing code
    const code = existing && existing.expiresAt > Date.now()
      ? existing.code
      : generateVerificationCode();

    // Persist metadata (reuse code if still valid, extend/refresh TTL and lastSentAt)
    verificationCodes.set(key, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      lastSentAt: Date.now(),
    });

    // Send email with verification code
    const LOGIN_GMAIL_USER = process.env.LOGIN_GMAIL_USER || process.env.GMAIL_USER;
    const LOGIN_GMAIL_PASS = process.env.LOGIN_GMAIL_PASS || process.env.GMAIL_PASS;
    const LOGIN_GMAIL_FROM =
      process.env.LOGIN_GMAIL_FROM || process.env.GMAIL_FROM || LOGIN_GMAIL_USER;

    if (!LOGIN_GMAIL_USER || !LOGIN_GMAIL_PASS) {
      return NextResponse.json(
        { error: "Email is not configured on the server" },
        { status: 500 }
      );
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: LOGIN_GMAIL_USER,
        pass: LOGIN_GMAIL_PASS,
      },
    });

    const mailOptions = {
      from: LOGIN_GMAIL_FROM,
      to: email,
      subject: 'Your Verification Code - Grand East Glass and Aluminum',
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

    await transporter.sendMail(mailOptions);

    return NextResponse.json({ 
      success: true, 
      message: "Verification code sent to your email" 
    });

  } catch (error: any) {
    console.error('Error sending verification code:', error);
    return NextResponse.json(
      { error: "Failed to send verification code" },
      { status: 500 }
    );
  }
}

// Endpoint to verify the code
export async function PUT(req: Request) {
  try {
    const { email, code } = await req.json();
    
    if (!email || !code) {
      return NextResponse.json({ error: "Email and code required" }, { status: 400 });
    }

    const stored = verificationCodes.get(email.toLowerCase());
    
    if (!stored) {
      return NextResponse.json({ error: "No verification code found" }, { status: 404 });
    }

    if (Date.now() > stored.expiresAt) {
      verificationCodes.delete(email.toLowerCase());
      return NextResponse.json({ error: "Verification code expired" }, { status: 400 });
    }

    if (stored.code !== code) {
      return NextResponse.json({ error: "Invalid verification code" }, { status: 400 });
    }

    // Code is valid, remove it
    verificationCodes.delete(email.toLowerCase());

    return NextResponse.json({ success: true, message: "Code verified successfully" });

  } catch (error: any) {
    console.error('Error verifying code:', error);
    return NextResponse.json(
      { error: "Failed to verify code" },
      { status: 500 }
    );
  }
}
