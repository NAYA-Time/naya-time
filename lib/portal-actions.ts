"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "./db";
import { sha256 } from "./crypto";
import { hit } from "./ratelimit";
import { PORTAL_COOKIE, acceptInvite, portalEmployee, portalLogin, requestVacation, withdrawRequest } from "./portal";
import type { FormState } from "./admin-actions-auth";

async function setCookie(s: { token: string; expiresAt: Date }) {
  (await cookies()).set(PORTAL_COOKIE, s.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/portal", expires: s.expiresAt });
}
async function client() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0].trim() ?? "?", ua: h.get("user-agent") };
}
export async function currentPortalEmployee() {
  return portalEmployee((await cookies()).get(PORTAL_COOKIE)?.value);
}

export async function acceptInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const { ip, ua } = await client();
  if (!(await hit(`portal-invite:${ip}`, 20, 900)).ok) return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut." };
  const pw = String(fd.get("password") ?? ""), pw2 = String(fd.get("password2") ?? "");
  if (pw !== pw2) return { error: "Die beiden Passwörter sind nicht gleich." };
  const r = await acceptInvite(String(fd.get("token") ?? ""), pw, ua);
  if (r.error) return { error: r.error };
  await setCookie(r.session!);
  redirect("/portal");
}

export async function portalLoginAction(_: FormState, fd: FormData): Promise<FormState> {
  const { ip, ua } = await client();
  const nr = String(fd.get("nr") ?? "").trim();
  if (!(await hit(`portal-login:${ip}`, 20, 900)).ok || !(await hit(`portal-login-nr:${nr}`, 8, 900)).ok) return { error: "Zu viele Versuche. Bitte in 15 Minuten erneut." };
  const r = await portalLogin(nr, String(fd.get("password") ?? ""), ua);
  if (r.error) return { error: r.error };
  await setCookie(r.session!);
  redirect("/portal");
}

export async function portalLogoutAction(): Promise<void> {
  const jar = await cookies();
  const t = jar.get(PORTAL_COOKIE)?.value;
  if (t) await prisma.session.deleteMany({ where: { tokenHash: sha256(t) } });
  jar.delete({ name: PORTAL_COOKIE, path: "/portal" });
  redirect("/portal/anmelden");
}

export async function requestVacationAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await currentPortalEmployee();
  if (!me) redirect("/portal/anmelden");
  if (!me.show.vacationRequests) return { error: "Urlaubsanträge sind für dich nicht freigeschaltet." };
  const r = await requestVacation(me.id, String(fd.get("from") ?? ""), String(fd.get("to") ?? ""), String(fd.get("note") ?? ""));
  if (r.ok) revalidatePath("/portal");
  return r;
}

export async function withdrawRequestAction(fd: FormData): Promise<void> {
  const me = await currentPortalEmployee();
  if (!me) redirect("/portal/anmelden");
  await withdrawRequest(me.id, String(fd.get("id") ?? ""));
  revalidatePath("/portal");
}
