// E-Mail-Versand über SMTP (z. B. Postfach beim Webhoster oder ein Versanddienst).
// Ohne SMTP_HOST ist der Versand aus; MAIL_TRANSPORT=json nur für Tests (nichts verlässt den Server).
import nodemailer from "nodemailer";

export function mailConfigured(): boolean {
  return process.env.MAIL_TRANSPORT === "json" || !!process.env.SMTP_HOST;
}

function transport() {
  if (process.env.MAIL_TRANSPORT === "json") return nodemailer.createTransport({ jsonTransport: true });
  if (!process.env.SMTP_HOST) throw new Error("E-Mail-Versand ist nicht eingerichtet (SMTP fehlt).");
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, // Berichte enthalten Personaldaten: nur verschlüsselt
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

export async function sendMail(to: string, subject: string, text: string, attachment?: { filename: string; content: Buffer }) {
  const info = await transport().sendMail({
    from: process.env.MAIL_FROM || "NAYA TIME <zeit@naya-restaurant.de>",
    to, subject, text,
    attachments: attachment ? [{ filename: attachment.filename, content: attachment.content, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }] : [],
  });
  return { providerId: info.messageId as string };
}
