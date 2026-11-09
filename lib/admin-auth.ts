import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { randomToken, sha256 } from "./crypto";

export const ADMIN_COOKIE = "naya_admin";
const SESSION_HOURS = 12;
const PENDING_MINUTES = 10;

export type AdminContext = Awaited<ReturnType<typeof loadAdmin>>;

export async function createAdminSession(adminUserId: string, mfaPassed: boolean, ip: string | null, ua: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (mfaPassed ? SESSION_HOURS * 3600_000 : PENDING_MINUTES * 60_000));
  await prisma.session.create({ data: { kind: "ADMIN", tokenHash: sha256(token), adminUserId, mfaPassed, expiresAt, ip, userAgent: ua?.slice(0, 200) } });
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires: expiresAt,
  });
}

export async function currentSession() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { adminUser: { include: { role: { include: { permissions: true } } } } } });
  if (!s || s.kind !== "ADMIN" || s.expiresAt < new Date() || !s.adminUser?.active) return null;
  return s;
}

async function loadAdmin() {
  const s = await currentSession();
  if (!s || !s.adminUser) return null;
  const a = s.adminUser;
  return {
    sessionId: s.id, mfaPassed: s.mfaPassed, reauthAt: s.reauthAt,
    id: a.id, name: a.name, email: a.email, roleKey: a.role.key, roleName: a.role.name, totpEnabled: a.totpEnabled,
    permissions: new Set([...a.role.permissions.map((p) => p.permissionKey), ...a.extraPermissions]),
  };
}

/** Für Seiten und Server-Aktionen: angemeldet + 2FA bestanden + Recht vorhanden – sonst Umleitung. */
export async function requireAdmin(permission?: string) {
  const a = await loadAdmin();
  if (!a) redirect("/admin/login");
  if (!a.totpEnabled) redirect("/admin/login/2fa-einrichten");
  if (!a.mfaPassed) redirect("/admin/login/2fa");
  if (permission && !a.permissions.has(permission)) redirect("/admin?kein-recht=" + encodeURIComponent(permission));
  return a;
}

export async function getPendingAdmin() {
  return loadAdmin();
}

export async function logout() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  (await cookies()).delete(ADMIN_COOKIE);
}

export function can(a: { permissions: Set<string> }, p: string) {
  return a.permissions.has(p);
}
