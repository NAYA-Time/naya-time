import { timingSafeEqual } from "node:crypto";

/** Cron-Aufrufe (z. B. Vercel Cron) nur mit "Authorization: Bearer <CRON_SECRET>" */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}
