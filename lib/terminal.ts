import { cookies, headers } from "next/headers";
import { prisma } from "./db";
import { sha256 } from "./crypto";

export const DEVICE_COOKIE = "naya_terminal";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
}

/** Nur gekoppelte, aktive iPads – optional nur aus dem Restaurant-Netz (öffentliche IP). */
export async function requireTerminal() {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!token) throw new HttpError(401, "Dieses Gerät ist nicht als Terminal freigeschaltet.", "NOT_PAIRED");
  const device = await prisma.terminalDevice.findUnique({ where: { tokenHash: sha256(token) } });
  if (!device || !device.active) throw new HttpError(401, "Dieses Gerät ist nicht als Terminal freigeschaltet.", "NOT_PAIRED");

  const allowed = (process.env.TERMINAL_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length) {
    const ip = await clientIp();
    if (!ip || !allowed.includes(ip)) throw new HttpError(403, "Stempeln ist nur im Restaurant-Netz möglich.", "WRONG_NETWORK");
  }
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
    await prisma.terminalDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }
  return device;
}

/** Fotofunktion nur aktiv, wenn eingeschaltet UND eine Datenschutz-Freigabe vorliegt. */
export async function photoPolicy(): Promise<{ enabled: boolean; retentionDays: number }> {
  const [setting, approval] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "photo.enabled" } }),
    prisma.dataProtectionApproval.findFirst({
      where: { feature: "PHOTO_CAPTURE", status: "APPROVED", revokedAt: null },
      orderBy: { approvedAt: "desc" },
    }),
  ]);
  return { enabled: setting?.value === true && !!approval, retentionDays: approval?.retentionDays ?? 30 };
}

export function jsonError(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Technischer Fehler. Bitte erneut versuchen." }, { status: 500 });
}
