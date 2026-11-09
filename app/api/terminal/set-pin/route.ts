import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashSecret, verifySecret } from "@/lib/crypto";
import { PIN_HISTORY, pinPolicyError } from "@/lib/pin";
import { hit } from "@/lib/ratelimit";
import { HttpError, clientIp, jsonError, requireTerminal } from "@/lib/terminal";
import { terminalGreeting } from "@/lib/terminal-session";

// Ersteinrichtung bzw. nach Rücksetzung: Einmalcode vom Inhaber + selbst gewählter PIN
export async function POST(req: Request) {
  try {
    const device = await requireTerminal();
    const ip = await clientIp();
    const { employeeId, setupCode, pin } = (await req.json()) as { employeeId?: string; setupCode?: string; pin?: string };
    if (!employeeId || !setupCode || !pin) throw new HttpError(400, "Angaben fehlen.");
    const rl = await hit(`setup:${employeeId}`, 5, 900);
    if (!rl.ok) throw new HttpError(429, "Zu viele Versuche. Bitte bei der Leitung melden.");

    const cred = await prisma.employeeCredential.findUnique({ where: { employeeId } });
    if (!cred?.setupCodeHash || !cred.setupCodeExpiresAt || cred.setupCodeExpiresAt < new Date() || !(await verifySecret(setupCode.trim(), cred.setupCodeHash))) {
      throw new HttpError(403, "Einrichtungscode ungültig oder abgelaufen.");
    }
    const policy = pinPolicyError(pin);
    if (policy) throw new HttpError(400, policy);
    const history = await prisma.pinHistory.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: PIN_HISTORY });
    for (const h of history) if (await verifySecret(pin, h.pinHash)) throw new HttpError(400, "Diesen PIN hast du schon einmal verwendet. Bitte einen neuen wählen.");

    const pinHash = await hashSecret(pin);
    await prisma.$transaction(async (tx) => {
      await tx.employeeCredential.update({
        where: { employeeId },
        data: { pinHash, pinSetAt: new Date(), mustSetPin: false, setupCodeHash: null, setupCodeExpiresAt: null, failedAttempts: 0, lockedUntil: null },
      });
      await tx.pinHistory.create({ data: { employeeId, pinHash } });
      await audit(tx, { actorKind: "EMPLOYEE", actorId: employeeId, action: "PIN_SET", entityType: "Employee", entityId: employeeId, employeeId, ip });
    });
    return Response.json(await terminalGreeting(employeeId, device.id));
  } catch (e) {
    return jsonError(e);
  }
}
