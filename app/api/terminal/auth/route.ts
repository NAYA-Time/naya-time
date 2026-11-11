import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { verifySecret } from "@/lib/crypto";
import { lockMinutes } from "@/lib/pin";
import { hit } from "@/lib/ratelimit";
import { HttpError, clientIp, jsonError, requireTerminal } from "@/lib/terminal";
import { terminalGreeting } from "@/lib/terminal-session";

export async function POST(req: Request) {
  try {
    const device = await requireTerminal();
    const ip = await clientIp();
    const { employeeId, personnelNumber, pin } = (await req.json()) as { employeeId?: string; personnelNumber?: string; pin?: string };
    if (!pin || !/^\d{6,8}$/.test(pin)) throw new HttpError(400, "Bitte 6 bis 8 Ziffern eingeben.");

    // Geräteweite Bremse gegen Durchprobieren fremder PINs
    const rl = await hit(`pin-device:${device.id}`, 40, 300);
    if (!rl.ok) throw new HttpError(429, `Zu viele Versuche an diesem Gerät. Bitte ${Math.ceil(rl.retryAfter / 60)} Min. warten.`);

    const emp = await prisma.employee.findFirst({
      where: { active: true, ...(employeeId ? { id: employeeId } : { personnelNumber: personnelNumber ?? "-" }) },
      include: { credential: true },
    });
    const cred = emp?.credential;
    if (!emp || !cred?.pinHash) throw new HttpError(401, "Name oder PIN falsch.");

    if (cred.lockedUntil && cred.lockedUntil > new Date()) {
      const min = Math.ceil((cred.lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpError(423, `Zu viele Fehlversuche. Bitte in ${min} Min. erneut versuchen oder bei der Leitung melden.`, "LOCKED");
    }

    if (!(await verifySecret(pin, cred.pinHash))) {
      let failed = 0, lock = 0;
      await prisma.$transaction(async (tx) => {
        // Zähler in der Datenbank erhöhen (nicht aus dem gelesenen Wert rechnen), damit gleichzeitige Versuche alle zählen
        failed = (await tx.employeeCredential.update({ where: { employeeId: emp.id }, data: { failedAttempts: { increment: 1 } } })).failedAttempts;
        lock = lockMinutes(failed);
        if (lock) await tx.employeeCredential.update({ where: { employeeId: emp.id }, data: { lockedUntil: new Date(Date.now() + lock * 60000) } });
        if (lock) await audit(tx, { actorKind: "TERMINAL", actorId: device.id, action: "PIN_LOCKED", entityType: "Employee", entityId: emp.id, employeeId: emp.id, after: { failed, lockMinutes: lock }, ip });
      });
      throw new HttpError(401, lock ? `PIN falsch. Aus Sicherheitsgründen ${lock} Min. gesperrt.` : "Name oder PIN falsch.");
    }
    if (cred.failedAttempts || cred.lockedUntil) {
      await prisma.employeeCredential.update({ where: { employeeId: emp.id }, data: { failedAttempts: 0, lockedUntil: null } });
    }
    return Response.json(await terminalGreeting(emp.id, device.id));
  } catch (e) {
    return jsonError(e);
  }
}
