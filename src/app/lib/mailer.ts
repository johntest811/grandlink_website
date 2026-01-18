import nodemailer from "nodemailer";

export function getMailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
}

export function getMailFrom() {
  return process.env.GMAIL_FROM || process.env.GMAIL_USER || "no-reply@grandlink";
}
