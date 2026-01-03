import nodemailer from "nodemailer";

type GeoInfo = {
  ip?: string;
  city?: string;
  region?: string;
  country_name?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  org?: string;
  timezone?: string;
};

function isPublicIp(ip: string) {
  const v = ip.trim();
  if (!v) return false;
  if (v.includes(":")) {
    // IPv6 — treat as public (we won't try to validate ranges here)
    return true;
  }

  // IPv4 checks for private ranges
  const parts = v.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  return true;
}

export async function lookupGeo(ip: string): Promise<GeoInfo | null> {
  if (!ip || !isPublicIp(ip)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: controller.signal,
      headers: { "User-Agent": "grandlink-security-alert" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return {
      ip: j?.ip,
      city: j?.city,
      region: j?.region,
      country_name: j?.country_name,
      postal: j?.postal,
      latitude: typeof j?.latitude === "number" ? j.latitude : Number(j?.latitude),
      longitude: typeof j?.longitude === "number" ? j.longitude : Number(j?.longitude),
      org: j?.org,
      timezone: j?.timezone,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendLoginSecurityAlertEmail(params: {
  toEmail: string;
  attempts: number;
  ip?: string;
  userAgent?: string;
  geo?: GeoInfo | null;
  lockedMinutes?: number;
}) {
  const { toEmail, attempts, ip, userAgent, geo, lockedMinutes } = params;

  const LOGIN_GMAIL_USER = process.env.LOGIN_GMAIL_USER || process.env.GMAIL_USER;
  const LOGIN_GMAIL_PASS = process.env.LOGIN_GMAIL_PASS || process.env.GMAIL_PASS;
  const LOGIN_GMAIL_FROM = process.env.LOGIN_GMAIL_FROM || process.env.GMAIL_FROM || LOGIN_GMAIL_USER;

  if (!LOGIN_GMAIL_USER || !LOGIN_GMAIL_PASS) {
    return { ok: false as const, error: "Email is not configured on the server" };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: LOGIN_GMAIL_USER,
      pass: LOGIN_GMAIL_PASS,
    },
  });

  const when = new Date().toLocaleString();
  const locationLine = geo
    ? [geo.city, geo.region, geo.country_name].filter(Boolean).join(", ")
    : "Location lookup unavailable";
  const ipLine = geo?.ip || ip || "Unknown";
  const orgLine = geo?.org ? ` (${geo.org})` : "";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #111; }
          .container { max-width: 640px; margin: 0 auto; padding: 20px; }
          .header { background: #8B1C1C; color: white; padding: 18px 20px; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
          .box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin: 12px 0; }
          .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
          .value { font-size: 14px; margin-top: 4px; }
          .warn { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin:0;">Security alert: Login attempts</h2>
            <p style="margin:6px 0 0 0;">We detected failed login attempts on your account.</p>
          </div>
          <div class="content">
            <div class="box">
              <div class="label">When</div>
              <div class="value">${when}</div>
            </div>
            <div class="box">
              <div class="label">Attempts</div>
              <div class="value">${attempts} failed attempt(s)</div>
            </div>
            <div class="box">
              <div class="label">IP</div>
              <div class="value">${ipLine}${orgLine}</div>
            </div>
            <div class="box">
              <div class="label">Location</div>
              <div class="value">${locationLine}${geo?.postal ? ` (${geo.postal})` : ""}</div>
            </div>
            <div class="box">
              <div class="label">Device</div>
              <div class="value">${(userAgent || "Unknown").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
            </div>
            <div class="warn">
              <strong>What you should do:</strong><br />
              If this wasn't you, reset your password immediately and consider enabling stronger security.
              ${lockedMinutes ? `<br /><br />We temporarily blocked further attempts for <strong>${lockedMinutes} minute(s)</strong>.` : ""}
            </div>
            <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">This is an automated message. Do not reply.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  await transporter.sendMail({
    from: LOGIN_GMAIL_FROM,
    to: toEmail,
    subject: "Security alert: Failed login attempts",
    html,
  });

  return { ok: true as const };
}
