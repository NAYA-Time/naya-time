// Handy-Portal für Mitarbeiter (Gunnar 09.11.2026): kein Stempeln. Nur ansehen, was der Inhaber per Häkchen freigibt,
// und Urlaubsanträge stellen. Stunden nur laufende Woche und laufender Monat, nichts aus früheren Wochen.
import { prisma } from "./db";
import { audit } from "./audit";
import { hashSecret, randomToken, sha256, verifySecret } from "./crypto";
import { loadMonth, runningBalance } from "./month-data";
import { myPlan, unseenPlanChanges } from "./terminal-session";
import { vacationInclude, vacationOverview } from "./vacation";
import { berlinDate, dbDate } from "./time";

export const PORTAL_COOKIE = "naya_portal";
export const PORTAL_DAYS = 90;
export const INVITE_DAYS = 7;
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// ── Einladung und Anmeldung ──

/** Neuer Einladungslink (alter wird ungültig). Gibt das Token im Klartext nur einmal zurück. */
export async function createInvite(employeeId: string, adminId: string): Promise<string> {
  const token = randomToken(24);
  await prisma.$transaction(async (tx) => {
    await tx.employeeCredential.update({ where: { employeeId }, data: { portalInviteHash: sha256(token), portalInviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86400000) } });
    await audit(tx, { actorKind: "ADMIN", actorId: adminId, action: "PORTAL_INVITE_CREATED", entityType: "Employee", entityId: employeeId, employeeId });
  });
  return token;
}

export async function inviteFor(token: string) {
  if (!token) return null;
  const c = await prisma.employeeCredential.findFirst({ where: { portalInviteHash: sha256(token) }, include: { employee: true } });
  if (!c || !c.portalEnabled || !c.employee.active || !c.portalInviteExpiresAt || c.portalInviteExpiresAt < new Date()) return null;
  return c;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Das Passwort muss mindestens 10 Zeichen lang sein.";
  if (/^\d+$/.test(pw)) return "Bitte nicht nur Ziffern verwenden (nicht deinen PIN).";
  return null;
}

/** Einladung annehmen: Passwort setzen, Link verbrauchen, Sitzung anlegen. Gibt das Sitzungs-Token zurück. */
export async function acceptInvite(token: string, password: string, ua: string | null): Promise<{ session?: { token: string; expiresAt: Date }; error?: string }> {
  const c = await inviteFor(token);
  if (!c) return { error: "Der Link ist ungültig oder abgelaufen. Bitte bei der Leitung einen neuen Link holen." };
  const p = passwordProblem(password);
  if (p) return { error: p };
  const hash = await hashSecret(password);
  await prisma.$transaction(async (tx) => {
    await tx.employeeCredential.update({ where: { employeeId: c.employeeId }, data: { portalPasswordHash: hash, portalInviteHash: null, portalInviteExpiresAt: null } });
    await tx.session.deleteMany({ where: { employeeId: c.employeeId, kind: "PORTAL" } });
    await audit(tx, { actorKind: "EMPLOYEE", actorId: c.employeeId, action: "PORTAL_PASSWORD_SET", entityType: "Employee", entityId: c.employeeId, employeeId: c.employeeId });
  });
  return { session: await createPortalSession(c.employeeId, ua) };
}

export async function createPortalSession(employeeId: string, ua: string | null) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PORTAL_DAYS * 86400000);
  await prisma.session.create({ data: { kind: "PORTAL", tokenHash: sha256(token), employeeId, mfaPassed: true, expiresAt, userAgent: ua?.slice(0, 200) } });
  return { token, expiresAt };
}

/** Anmeldung mit Personalnummer + Passwort */
export async function portalLogin(personnelNumber: string, password: string, ua: string | null): Promise<{ session?: { token: string; expiresAt: Date }; error?: string }> {
  const bad = { error: "Personalnummer oder Passwort stimmt nicht." };
  const e = await prisma.employee.findUnique({ where: { personnelNumber: personnelNumber.trim() }, include: { credential: true } });
  if (!e?.credential?.portalPasswordHash) { await hashSecret(password); return bad; } // gleiche Rechenzeit
  if (!(await verifySecret(password, e.credential.portalPasswordHash))) return bad;
  if (!e.active || !e.credential.portalEnabled) return { error: "Dein Zugang ist gesperrt. Bitte bei der Leitung melden." };
  return { session: await createPortalSession(e.id, ua) };
}

/** Sitzung prüfen – bei jeder Anfrage: gesperrt oder deaktiviert = sofort draußen */
export async function portalEmployee(token: string | undefined) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { employee: { include: { credential: true, portalSettings: true } } } });
  if (!s || s.kind !== "PORTAL" || s.expiresAt < new Date() || !s.employee) return null;
  const e = s.employee;
  if (!e.active || !e.credential?.portalEnabled || !e.credential.portalPasswordHash) return null;
  return { id: e.id, firstName: e.firstName, lastName: e.lastName, personnelNumber: e.personnelNumber, sessionId: s.id, show: visibility(e.portalSettings) };
}

export type Visibility = ReturnType<typeof visibility>;
function visibility(v: { schedule: boolean; weeklyHours: boolean; weeklyTarget: boolean; monthlyHours: boolean; monthlyTarget: boolean; accountBalance: boolean; minusHours: boolean; vacationRemaining: boolean; vacationRequests: boolean } | null) {
  return {
    schedule: !!v?.schedule, weeklyHours: !!v?.weeklyHours, weeklyTarget: !!v?.weeklyTarget, monthlyHours: !!v?.monthlyHours, monthlyTarget: !!v?.monthlyTarget,
    accountBalance: !!v?.accountBalance, minusHours: !!v?.minusHours, vacation: !!v?.vacationRemaining, vacationRequests: !!v?.vacationRequests,
  };
}

// ── Inhalte (nur was freigegeben ist) ──

export async function portalOverview(employeeId: string, show: Visibility, now = new Date()) {
  const today = berlinDate(now);
  const monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
  const month = today.slice(0, 7);
  const needMonth = show.monthlyHours || show.monthlyTarget;
  const [plan, changes, weekSessions, contract, monthRes, balance, vac, requests, approved] = await Promise.all([
    show.schedule ? myPlan(employeeId, now) : null,
    show.schedule ? unseenPlanChanges(employeeId, now) : [],
    show.weeklyHours ? prisma.workSession.findMany({ where: { employeeId, workDate: { gte: dbDate(monday), lte: dbDate(today) } }, select: { payableMinutes: true, status: true } }) : null,
    show.weeklyTarget ? prisma.employeeContract.findFirst({ where: { employeeId, validFrom: { lte: dbDate(today) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(today) } }] }, orderBy: { validFrom: "desc" } }) : null,
    needMonth ? loadMonth(prisma, employeeId, month, undefined, today).catch(() => null) : null,
    show.accountBalance || show.minusHours ? runningBalance(prisma, employeeId, today).catch(() => null) : null,
    show.vacation ? vacationFor(employeeId, today) : null,
    show.vacationRequests ? prisma.vacationRequest.findMany({ where: { employeeId, OR: [{ status: "OPEN" }, { endDate: { gte: dbDate(today) } }] }, orderBy: { startDate: "asc" } }) : [],
    show.vacation ? prisma.absence.findMany({ where: { employeeId, type: "VACATION", status: { not: "CANCELLED" }, endDate: { gte: dbDate(today) } }, orderBy: { startDate: "asc" }, include: { days: true } }) : [],
  ]);
  return {
    plan, changes,
    week: weekSessions ? { worked: weekSessions.reduce((a, s) => a + (s.payableMinutes ?? 0), 0), open: weekSessions.some((s) => s.status === "OPEN"), from: monday } : null,
    weekTarget: contract?.weeklyMinutes ?? null,
    month: monthRes ? { worked: show.monthlyHours ? monthRes.worked : null, target: show.monthlyTarget ? monthRes.target : null, label: month } : null,
    balance: balance === null ? null : show.accountBalance ? balance : balance < 0 ? balance : null,
    vacation: vac,
    approved: approved.map((a) => ({ from: berlinDate(a.startDate), to: berlinDate(a.endDate), days: a.days.reduce((x, d) => x + d.vacationDayValue, 0) / 2 })),
    requests: requests.map((r) => ({ id: r.id, from: berlinDate(r.startDate), to: berlinDate(r.endDate), status: r.status, note: r.note, decisionNote: r.decisionNote })),
  };
}

async function vacationFor(employeeId: string, today: string) {
  const year = Number(today.slice(0, 4));
  const [v] = await vacationOverview([await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: vacationInclude(year) })], year);
  return { year, entitlement: v.entitlement + v.carry, taken: v.taken, planned: v.planned, rest: v.rest, carryOpen: v.carryOpen, carryExpires: v.carryExpires };
}

/** Urlaubsantrag stellen */
export async function requestVacation(employeeId: string, from: string, to: string, note: string, today = berlinDate(new Date())): Promise<{ ok?: string; error?: string }> {
  to = to || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return { error: "Bitte Von und Bis richtig angeben." };
  if (from < today) return { error: "Urlaub kann nur für die Zukunft beantragt werden." };
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 60) return { error: "Bitte höchstens 60 Tage auf einmal beantragen." };
  const overlap = await prisma.vacationRequest.findFirst({ where: { employeeId, status: { in: ["OPEN", "APPROVED"] }, startDate: { lte: dbDate(to) }, endDate: { gte: dbDate(from) } } });
  if (overlap) return { error: "Für diesen Zeitraum gibt es schon einen Antrag." };
  const open = await prisma.vacationRequest.count({ where: { employeeId, status: "OPEN" } });
  if (open >= 5) return { error: "Du hast schon 5 offene Anträge. Bitte warte auf die Entscheidung." };
  await prisma.$transaction(async (tx) => {
    const r = await tx.vacationRequest.create({ data: { employeeId, startDate: dbDate(from), endDate: dbDate(to), note: note.trim().slice(0, 300) || null } });
    await audit(tx, { actorKind: "EMPLOYEE", actorId: employeeId, action: "VACATION_REQUESTED", entityType: "VacationRequest", entityId: r.id, employeeId, after: { from, to } });
  });
  return { ok: "Antrag gestellt. Du siehst hier, sobald er entschieden ist." };
}

export async function withdrawRequest(employeeId: string, id: string): Promise<void> {
  const r = await prisma.vacationRequest.findFirst({ where: { id, employeeId, status: "OPEN" } });
  if (!r) return;
  await prisma.$transaction(async (tx) => {
    await tx.vacationRequest.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
    await audit(tx, { actorKind: "EMPLOYEE", actorId: employeeId, action: "VACATION_REQUEST_WITHDRAWN", entityType: "VacationRequest", entityId: id, employeeId });
  });
}
