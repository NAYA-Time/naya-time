import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { randomToken, sha256, verifySecret } from "@/lib/crypto";
import { hit } from "@/lib/ratelimit";
import { DEVICE_COOKIE, HttpError, clientIp, jsonError } from "@/lib/terminal";

// Koppelt ein iPad mit einem einmaligen Kopplungscode (erzeugt vom Inhaber: npm run pair, später im Backoffice).
export async function POST(req: Request) {
  try {
    const ip = await clientIp();
    const rl = await hit(`pair:${ip ?? "?"}`, 5, 900);
    if (!rl.ok) throw new HttpError(429, "Zu viele Versuche. Bitte später erneut.");
    const { code, name } = (await req.json()) as { code?: string; name?: string };
    if (!code) throw new HttpError(400, "Code fehlt.");
    const setting = await prisma.systemSetting.findUnique({ where: { key: "terminal.pairingCode" } });
    const v = setting?.value as { hash: string; expiresAt: string } | null;
    if (!v || new Date(v.expiresAt) < new Date() || !(await verifySecret(code.trim().toUpperCase(), v.hash))) {
      throw new HttpError(403, "Kopplungscode ungültig oder abgelaufen.");
    }
    const token = randomToken();
    const device = await prisma.$transaction(async (tx) => {
      await tx.systemSetting.delete({ where: { key: "terminal.pairingCode" } }); // nur einmal verwendbar
      const d = await tx.terminalDevice.create({ data: { name: (name || "iPad Terminal").slice(0, 60), tokenHash: sha256(token) } });
      await audit(tx, { actorKind: "SYSTEM", action: "TERMINAL_PAIRED", entityType: "TerminalDevice", entityId: d.id, ip });
      return d;
    });
    (await cookies()).set(DEVICE_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 400,
    });
    return Response.json({ ok: true, name: device.name });
  } catch (e) {
    return jsonError(e);
  }
}
