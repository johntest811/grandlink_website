import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";

type AttachmentInput = {
  filename: string;
  content: any;
  contentType?: string;
};

type SimpleMailOptions = {
  from?: any;
  to: any;
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
};

let sendgridReady = false;
let primaryGmailTransporter: nodemailer.Transporter | null = null;
let backupGmailTransporter: nodemailer.Transporter | null = null;
let invoicePrimaryGmailTransporter: nodemailer.Transporter | null = null;
let invoiceBackupGmailTransporter: nodemailer.Transporter | null = null;

function normalizePass(pass: string) {
  return pass.replace(/\s+/g, "");
}

function shouldRetryWithBackupProvider(err: any) {
  const message = String(err?.message || err || "").toLowerCase();
  const responseCode = Number(err?.responseCode || err?.statusCode || 0);

  if ([550, 551, 552, 553, 554].includes(responseCode)) return false;
  if (message.includes("invalid") && message.includes("address")) return false;
  if (message.includes("no such user")) return false;
  if (message.includes("recipient")) return false;

  return true;
}

function hasSendGridConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY);
}

function getSendGridFrom() {
  const email = process.env.SENDGRID_FROM_EMAIL || getMailFrom();
  const name = process.env.SENDGRID_FROM_NAME || undefined;
  return name ? { email, name } : email;
}

function getOrCreatePrimaryGmailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;
  if (!user || !pass) return null;
  if (primaryGmailTransporter) return primaryGmailTransporter;
  primaryGmailTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: normalizePass(pass) },
  });
  return primaryGmailTransporter;
}

function getOrCreateBackupGmailTransporter() {
  const user = process.env.GMAIL_BACKUP_USER;
  const pass = process.env.GMAIL_BACKUP_PASS;
  if (!user || !pass) return null;
  if (backupGmailTransporter) return backupGmailTransporter;
  backupGmailTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: normalizePass(pass) },
  });
  return backupGmailTransporter;
}

function getOrCreateInvoicePrimaryGmailTransporter() {
  const user = process.env.INVOICE_GMAIL_USER;
  const pass = process.env.INVOICE_GMAIL_PASS;
  if (!user || !pass) return null;
  if (invoicePrimaryGmailTransporter) return invoicePrimaryGmailTransporter;
  invoicePrimaryGmailTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: normalizePass(pass) },
  });
  return invoicePrimaryGmailTransporter;
}

function getOrCreateInvoiceBackupGmailTransporter() {
  const user = process.env.INVOICE_GMAIL_BACKUP_USER;
  const pass = process.env.INVOICE_GMAIL_BACKUP_PASS;
  if (!user || !pass) return null;
  if (invoiceBackupGmailTransporter) return invoiceBackupGmailTransporter;
  invoiceBackupGmailTransporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass: normalizePass(pass) },
  });
  return invoiceBackupGmailTransporter;
}

function coerceToList(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  const text = String(value);
  // Nodemailer supports comma-separated strings.
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function encodeAttachmentContent(content: any) {
  if (content == null) return "";
  if (Buffer.isBuffer(content)) return content.toString("base64");
  if (typeof content === "string") return Buffer.from(content, "utf8").toString("base64");
  if (content instanceof Uint8Array) return Buffer.from(content).toString("base64");
  return Buffer.from(String(content), "utf8").toString("base64");
}

async function sendViaSendGrid(options: SimpleMailOptions) {
  if (!process.env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");
  if (!sendgridReady) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    sendgridReady = true;
  }

  const toList = coerceToList(options.to);
  const from = options.from || getSendGridFrom();
  const attachments = (options.attachments || []).map((a) => ({
    filename: a.filename,
    content: encodeAttachmentContent(a.content),
    type: a.contentType,
    disposition: "attachment",
  }));

  await sgMail.send({
    to: toList.length === 1 ? toList[0] : toList,
    from: from as any,
    subject: options.subject,
    text: options.text,
    html: options.html,
    ...(attachments.length ? { attachments } : {}),
  } as any);
}

async function sendViaGmail(options: SimpleMailOptions) {
  const primary = getOrCreatePrimaryGmailTransporter();
  const backup = getOrCreateBackupGmailTransporter();

  if (primary) {
    try {
      await primary.sendMail({
        from: options.from || process.env.GMAIL_FROM || process.env.GMAIL_USER!,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments as any,
      });
      return;
    } catch (err: any) {
      console.warn("Primary Gmail send failed:", err);
      if (!backup || !shouldRetryWithBackupProvider(err)) throw err;
    }
  }

  if (backup) {
    await backup.sendMail({
      from: options.from || process.env.GMAIL_BACKUP_FROM || process.env.GMAIL_BACKUP_USER!,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments as any,
    });
    return;
  }

  throw new Error("No Gmail credentials configured");
}

export function getMailTransporter() {
  // Keep the legacy API surface (transporter.sendMail), but route through
  // SendGrid when configured (works on Vercel) and fall back to Gmail.
  const transporter = {
    async sendMail(options: SimpleMailOptions) {
      if (hasSendGridConfigured()) {
        await sendViaSendGrid(options);
        return;
      }
      await sendViaGmail(options);
    },
  };

  const hasGmail = Boolean(
    (process.env.GMAIL_USER && process.env.GMAIL_PASS) ||
      (process.env.GMAIL_BACKUP_USER && process.env.GMAIL_BACKUP_PASS)
  );

  if (!hasSendGridConfigured() && !hasGmail) return null;
  return transporter as any;
}

export function getMailFrom() {
  return (
    process.env.SENDGRID_FROM_EMAIL ||
    process.env.GMAIL_FROM ||
    process.env.GMAIL_USER ||
    process.env.GMAIL_BACKUP_FROM ||
    process.env.GMAIL_BACKUP_USER ||
    "no-reply@grandlink"
  );
}

export function getInvoiceMailTransporter() {
  const primary = getOrCreateInvoicePrimaryGmailTransporter();
  const backup = getOrCreateInvoiceBackupGmailTransporter();

  if (!primary && !backup) {
    return getMailTransporter();
  }

  return {
    async sendMail(options: SimpleMailOptions) {
      if (primary) {
        try {
          await primary.sendMail({
            from: options.from || getInvoiceMailFrom(),
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments: options.attachments as any,
          });
          return;
        } catch (err: any) {
          console.warn("Primary invoice Gmail send failed:", err);
          if (!backup || !shouldRetryWithBackupProvider(err)) throw err;
        }
      }

      if (backup) {
        await backup.sendMail({
          from: options.from || getInvoiceMailFrom(),
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
          attachments: options.attachments as any,
        });
        return;
      }

      throw new Error("No invoice mail transport configured");
    },
  } as any;
}

export function getInvoiceMailFrom() {
  return (
    process.env.INVOICE_GMAIL_FROM ||
    process.env.INVOICE_GMAIL_USER ||
    getMailFrom()
  );
}
