"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "./db";
import { audit } from "./audit";
import { hashSecret, openSecret, sealSecret, verifySecret } from "./crypto";
import { hit } from "./ratelimit";
import { newTotpSecret, otpauthUrl, verifyTotp } from "./totp";
import { createAdminSession, currentSession, logout, requireAdmin } from "./admin-auth";
import { RECOVERY_RE, consumeRecoveryCode, newRecoveryCodes } from "./recovery";

export type FormState = { error?: string; ok?: string } | undefined;

async function reqInfo() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0].trim() ?? null, ua: h.get("user-agent") };
}

function passwordError(pw: string): string | null {
  if (pw.length < 12) return "Das Kennwort muss mindestens 12 Zeichen haben.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Bitte Buchstaben und Ziffern kombinieren.";
  return null;
}

export async function setupAdmin(_: FormState, fd: FormData): Promise<FormState> {
  const token = String(fd.get("token") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const pw = String(fd.get("password") ?? "");
  const setting = await prisma.systemSetting.findUnique({ where: { key: "admin.setupToken" } });
  const v = setting?.value as { hash: string; expiresAt: string; role: string } | null;
  if (!v || new Date(v.expiresAt) < new Date() || !(await verifySecret(token, v.hash))) return { error: "Der Einrichtungslink ist ungültig oder abgelaufen." };
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Bitte Name und gültige E-Mail angeben." };
  const pe = passwordError(pw);
  if (pe) return { error: pe };
  if (pw !== String(fd.get("password2") ?? "")) return { error: "Die Kennwörter stimmen nicht überein." };
  if (await prisma.adminUser.findUnique({ where: { email } })) return { error: "Für diese E-Mail gibt es bereits ein Konto." };
  const role = await prisma.role.findUniqueOrThrow({ where: { key: v.role } });
  const { ip, ua } = await reqInfo();
  const admin = await prisma.$transaction(async (tx) => {
    await tx.systemSetting.delete({ where: { key: "admin.setupToken" } }); // Link nur einmal verwendbar
    const a = await tx.adminUser.create({ data: { email, name, passwordHash: await hashSecret(pw), roleId: role.id } });
    await audit(tx, { actorKind: "SYSTEM", action: "ADMIN_CREATED", entityType: "AdminUser", entityId: a.id, after: { email, role: role.key }, ip });
    return a;
  });
  await createAdminSession(admin.id, false, ip, ua);
  redirect("/admin/login/2fa-einrichten");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const pw = String(fd.get("password") ?? "");
  const { ip, ua } = await reqInfo();
  const rl = await hit(`login:${ip ?? "?"}`, 20, 900);
  if (!rl.ok) return { error: "Zu viele Anmeldeversuche. Bitte 15 Minuten warten." };
  const a = await prisma.adminUser.findUnique({ where: { email } });
  if (a?.lockedUntil && a.lockedUntil > new Date()) return { error: "Konto vorübergehend gesperrt. Bitte später erneut versuchen." };
  if (!a || !a.active || !(await verifySecret(pw, a.passwordHash))) {
    if (a) {
      const failed = a.failedLogins + 1;
      await prisma.adminUser.update({ where: { id: a.id }, data: { failedLogins: failed, lockedUntil: failed >= 10 ? new Date(Date.now() + 15 * 60_000) : null } });
    }
    return { error: "E-Mail oder Kennwort falsch." };
  }
  await prisma.adminUser.update({ where: { id: a.id }, data: { failedLogins: 0, lockedUntil: null } });
  await createAdminSession(a.id, false, ip, ua);
  redirect(a.totpEnabled ? "/admin/login/2fa" : "/admin/login/2fa-einrichten");
}

async function upgradeSession(sessionId: string, adminId: string) {
  const { ip, ua } = await reqInfo();
  await prisma.session.delete({ where: { id: sessionId } }); // neue Sitzungs-ID nach 2FA (Schutz vor Session-Fixation)
  await createAdminSession(adminId, true, ip, ua);
  await prisma.adminUser.update({ where: { id: adminId }, data: { lastLoginAt: new Date() } });
}

export async function verify2fa(_: FormState, fd: FormData): Promise<FormState> {
  const s = await currentSession();
  if (!s?.adminUser?.totpSecretEnc) redirect("/admin/login");
  const rl = await hit(`2fa:${s.adminUserId}`, 6, 300);
  if (!rl.ok) return { error: "Zu viele Versuche. Bitte 5 Minuten warten." };
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (RECOVERY_RE.test(code) && !/^\d+$/.test(code)) {
    // Wiederherstellungscode statt App-Code (Handy verloren)
    const rest = await consumeRecoveryCode(s.adminUser.recoveryCodes, code);
    if (!rest) return { error: "Code falsch oder bereits verwendet." };
    const adminId = s.adminUser.id;
    const { ip } = await reqInfo();
    await prisma.$transaction(async (tx) => {
      await tx.adminUser.update({ where: { id: adminId }, data: { recoveryCodes: rest } });
      await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "ADMIN_RECOVERY_CODE_USED", entityType: "AdminUser", entityId: adminId, after: { remaining: rest.length }, ip });
    });
    await upgradeSession(s.id, adminId);
    redirect("/admin/konto?code-verwendet=1");
  }
  if (!verifyTotp(openSecret(s.adminUser.totpSecretEnc), code)) return { error: "Code falsch oder abgelaufen." };
  await upgradeSession(s.id, s.adminUser.id);
  redirect("/admin");
}

export async function totpEnrollmentData() {
  const s = await currentSession();
  if (!s?.adminUser) redirect("/admin/login");
  if (s.adminUser.totpEnabled) redirect("/admin/login/2fa");
  let secret: string;
  if (s.adminUser.totpSecretEnc) secret = openSecret(s.adminUser.totpSecretEnc);
  else {
    secret = newTotpSecret();
    await prisma.adminUser.update({ where: { id: s.adminUser.id }, data: { totpSecretEnc: sealSecret(secret) } });
  }
  const url = otpauthUrl(secret, s.adminUser.email);
  return { secret: secret.match(/.{1,4}/g)!.join(" "), qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) };
}

export async function confirmTotp(_: FormState, fd: FormData): Promise<FormState> {
  const s = await currentSession();
  if (!s?.adminUser?.totpSecretEnc) redirect("/admin/login");
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  if (!verifyTotp(openSecret(s.adminUser.totpSecretEnc), code)) return { error: "Code falsch. Bitte den aktuellen Code aus der App eingeben." };
  const adminId = s.adminUser.id;
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id: adminId }, data: { totpEnabled: true } });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "ADMIN_2FA_ENABLED", entityType: "AdminUser", entityId: adminId });
  });
  await upgradeSession(s.id, adminId);
  redirect("/admin/konto?neu=1");
}

/** Neue Wiederherstellungscodes – alte werden ungültig. Die Codes werden nur dieses eine Mal angezeigt. */
export async function regenerateRecoveryCodes(_: unknown, fd: FormData): Promise<{ codes?: string[]; error?: string } | undefined> {
  const a = await requireAdmin();
  const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: a.id } });
  if (!(await verifySecret(String(fd.get("password") ?? ""), row.passwordHash))) return { error: "Kennwort falsch." };
  const { plain, hashes } = await newRecoveryCodes();
  const { ip } = await reqInfo();
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id: a.id }, data: { recoveryCodes: hashes } });
    await audit(tx, { actorKind: "ADMIN", actorId: a.id, action: "ADMIN_RECOVERY_CODES_CREATED", entityType: "AdminUser", entityId: a.id, after: { count: hashes.length }, ip });
  });
  return { codes: plain };
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}
