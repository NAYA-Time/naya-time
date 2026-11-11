import Link from "next/link";
import { PhotoButton } from "@/components/PhotoViewer";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { addSessionAction, correctSessionAction } from "@/lib/admin-actions-corrections";
import { ADD_SESSION_PERMISSION } from "@/lib/corrections";
import { currentDeptFilter, matchesEmp } from "@/lib/dept";
import { berlinDate, berlinTime, dbDate, fmtMinutes } from "@/lib/time";
import { ActionForm, Field } from "@/components/ActionForm";
import { Check } from "@/components/Select";

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const FIELD: Record<string, string> = { CLOCK_IN: "Beginn", CLOCK_OUT: "Ende", BREAK_MINUTES: "Pause", SESSION_VOID: "Fehlbuchung", PAYABLE_START: "Früher Beginn genehmigt", ADD_SESSION: "Nachtrag" };
const show = (field: string, v: string | null) => (v == null ? "–" : field === "BREAK_MINUTES" ? `${v} Min.` : field === "SESSION_VOID" || field === "PAYABLE_START" ? (v === "true" ? "ja" : "nein") : berlinTime(new Date(v)));

export default async function ZeitenPage({ searchParams }: { searchParams: Promise<{ von?: string; bis?: string; nur?: string }> }) {
  const admin = await requireAdmin("timeclock.view");
  const sp = await searchParams;
  const today = berlinDate(new Date());
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.bis ?? "") ? sp.bis! : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.von ?? "") ? sp.von! : addDays(to, -13);
  const onlyOpen = sp.nur === "offen";
  const filter = await currentDeptFilter();
  const sessions = await prisma.workSession.findMany({
    where: onlyOpen ? { status: { not: "CLOSED" } } : { workDate: { gte: dbDate(from), lte: dbDate(to) } },
    include: { employee: { include: { primaryDept: { include: { parent: true } } } }, department: { include: { parent: true } }, clockInEvent: { include: { photo: true } }, clockOutEvent: { include: { photo: true } }, corrections: { orderBy: { createdAt: "asc" } }, breaks: { select: { minutes: true } } },
    orderBy: [{ workDate: "desc" }, { clockInEvent: { effectiveAt: "desc" } }], take: 500,
  });
  const rows = sessions.filter((s) => matchesEmp(filter, s.employee, s.department));
  const missing = await prisma.workSession.count({ where: { status: "MISSING_CLOCK_OUT" } });
  const canCorrect = admin.permissions.has("timeclock.correct");
  const canPhotos = admin.permissions.has("photos.view");
  const canAdd = admin.permissions.has(ADD_SESSION_PERMISSION);
  const authorIds = [...new Set(sessions.flatMap((s) => s.corrections.map((c) => c.createdById)))];
  const authors = new Map((await prisma.adminUser.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const employees = canAdd ? await prisma.employee.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }) : [];
  type Ev = { id: string; isOffline: boolean; offlineTrust: string | null; photo: { deletedAt: Date | null } | null };
  const evInfo = (e: Ev) => (
    <>
      {e.isOffline && <span className={e.offlineTrust === "TRUSTED" ? "text-mute" : "text-warn"}> · offline{e.offlineTrust === "TRUSTED" ? "" : " (Zeit prüfen)"}</span>}
      {canPhotos && e.photo && (e.photo.deletedAt ? <span className="text-mute"> · Foto gelöscht</span> : <> · <a href={`/admin/zeiten/foto/${e.id}`} target="_blank" className="text-gold underline">Foto</a></>)}
    </>
  );
  return (
    <div className="grid max-w-6xl gap-5">
      <h1 className="text-3xl font-semibold">Zeitbuchungen</h1>
      <p className="text-mute">Die Original-Stempelzeiten bleiben immer erhalten. Korrekturen werden mit Grund und Name gespeichert und sind hier und im Änderungsprotokoll sichtbar.</p>
      {missing > 0 && !onlyOpen && <Link href="/admin/zeiten?nur=offen" className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">{missing} Schicht{missing > 1 ? "en" : ""} ohne Ausstempeln – bitte Ende nachtragen →</Link>}
      <form className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm text-mute">Von<input type="date" name="von" defaultValue={from} className="min-h-12 rounded-xl border border-line bg-ink px-4 text-paper" /></label>
        <label className="grid gap-1.5 text-sm text-mute">Bis<input type="date" name="bis" defaultValue={to} className="min-h-12 rounded-xl border border-line bg-ink px-4 text-paper" /></label>
        <button className="min-h-12 rounded-xl border border-line px-5 hover:bg-slate">Anzeigen</button>
        <Link href="/admin/zeiten?nur=offen" className={`min-h-12 rounded-xl border px-5 py-3 ${onlyOpen ? "border-gold text-gold" : "border-line hover:bg-slate"}`}>Nur offene</Link>
      </form>
      {canAdd && (
        <details className="rounded-xl border border-line bg-coal">
          <summary className="cursor-pointer px-4 py-3 font-semibold">+ Vergessene Schicht nachtragen</summary>
          <div className="border-t border-line px-4 py-4">
            <p className="mb-4 text-sm text-mute">Nur für Schichten ganz ohne Stempelung. Die Schicht wird deutlich als „nachgetragen“ markiert, mit deinem Namen, Zeitpunkt und Grund.</p>
            <ActionForm action={addSessionAction} submit="Schicht nachtragen">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm text-mute">Mitarbeiter
                  <select name="employeeId" required className="min-h-12 rounded-xl border border-line bg-ink px-4 text-paper">
                    <option value="">Bitte wählen</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName}</option>)}
                  </select>
                </label>
                <Field label="Datum" name="date" type="date" defaultValue={today} required />
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Field label="Beginn" name="clockIn" type="time" required />
                <Field label="Ende" name="clockOut" type="time" required hint="vor Beginn = nächster Tag" />
                <Field label="Pause (Min.)" name="breakMinutes" type="number" min={0} defaultValue={0} />
              </div>
              <Field label="Grund (Pflicht)" name="reason" required />
            </ActionForm>
          </div>
        </details>
      )}
      <div className="grid gap-2">
        {rows.map((s) => {
          const corrected = s.corrections.length > 0;
          const lastIn = [...s.corrections].reverse().find((c) => c.field === "CLOCK_IN");
          const lastOut = [...s.corrections].reverse().find((c) => c.field === "CLOCK_OUT");
          const inAt = lastIn ? new Date(lastIn.correctedValue) : s.clockInEvent!.effectiveAt;
          const added = s.corrections.find((c) => c.field === "ADD_SESSION");
          const outAt = lastOut ? new Date(lastOut.correctedValue) : s.clockOutEvent?.effectiveAt ?? null;
          const voided = [...s.corrections].reverse().find((c) => c.field === "SESSION_VOID")?.correctedValue === "true";
          // Aktuell gültige Pause: letzte Korrektur, sonst Summe der gestempelten Pausen (auch bei „Ausstempeln fehlt“, wo s.breakMinutes 0 ist)
          const lastBreak = [...s.corrections].reverse().find((c) => c.field === "BREAK_MINUTES");
          const currentBreak = lastBreak ? Number(lastBreak.correctedValue) : s.breaks.reduce((a, b) => a + b.minutes, 0);
          return (
            <details key={s.id} className={`rounded-xl border bg-coal ${s.status === "MISSING_CLOCK_OUT" ? "border-warn/60" : "border-line"}`}>
              <summary className="grid cursor-pointer grid-cols-2 gap-2 px-4 py-3 text-sm tabular sm:grid-cols-[7rem_1fr_6rem_6rem_6rem_6rem_9rem]">
                <span>{s.workDate.toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" })}</span>
                <span className="flex flex-wrap items-center gap-2 font-semibold">{s.employee.firstName} {s.employee.lastName}
                  {canPhotos && <PhotoButton name={`${s.employee.firstName} ${s.employee.lastName}`} date={s.workDate.toLocaleDateString("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                    photos={[["Kommen", s.clockInEvent], ["Gehen", s.clockOutEvent]].flatMap(([label, e]) => { const ev = e as typeof s.clockOutEvent; return ev?.photo && !ev.photo.deletedAt ? [{ id: ev.id, label: label as string, time: berlinTime(ev.effectiveAt) }] : []; })} />}
                </span>
                <span>{berlinTime(inAt)}{lastIn && !added && "*"}</span>
                <span>{outAt ? `${berlinTime(outAt)}${lastOut && !added ? "*" : ""}` : "–"}</span>
                <span className="text-mute">{s.status === "MISSING_CLOCK_OUT" ? currentBreak : s.breakMinutes} Min.</span>
                <span className="font-bold">{fmtMinutes(s.payableMinutes)}</span>
                <span className={s.status === "MISSING_CLOCK_OUT" ? "text-warn" : s.status === "OPEN" ? "text-good" : voided ? "text-bad" : "text-mute"}>
                  {voided ? "Fehlbuchung" : added ? "nachgetragen" : s.status === "MISSING_CLOCK_OUT" ? "Ausstempeln fehlt" : s.status === "OPEN" ? "eingestempelt" : corrected ? "korrigiert" : "ok"}
                </span>
              </summary>
              <div className="grid gap-4 border-t border-line px-4 py-4 text-sm">
                {added || !s.clockInEvent ? (
                  <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-warn">
                    Nachgetragen von {authors.get(added?.createdById ?? "") ?? "unbekannt"} am {added?.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })} · keine Stempelung vorhanden · Grund: „{added?.reason}“
                    {s.plannedStartAt && s.plannedEndAt ? ` · geplant ${berlinTime(s.plannedStartAt)}–${berlinTime(s.plannedEndAt)}` : ""}
                  </p>
                ) : (
                <p className="text-mute">Original-Stempelung: Kommen {berlinTime(s.clockInEvent.effectiveAt)} (Nr. {s.clockInEvent.bookingNo.toString()}){evInfo(s.clockInEvent)}{s.clockOutEvent ? <>, Gehen {berlinTime(s.clockOutEvent.effectiveAt)} (Nr. {s.clockOutEvent.bookingNo.toString()}){evInfo(s.clockOutEvent)}</> : ", kein Gehen gestempelt"}{s.plannedStartAt && s.plannedEndAt ? ` · geplant ${berlinTime(s.plannedStartAt)}–${berlinTime(s.plannedEndAt)}` : ""}</p>
                )}
                {corrected && (
                  <ul className="grid gap-1">
                    {s.corrections.filter((c) => c.field !== "ADD_SESSION").map((c) => <li key={c.id}>{c.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}: {FIELD[c.field]} {show(c.field, c.originalValue)} → {show(c.field, c.correctedValue)} · {authors.get(c.createdById) ?? "unbekannt"} · „{c.reason}“</li>)}
                  </ul>
                )}
                {canCorrect && !voided && (
                  <ActionForm action={correctSessionAction} submit="Korrektur speichern">
                    <input type="hidden" name="id" value={s.id} />
                    <div className="grid items-start gap-4 sm:grid-cols-3">
                      <Field label="Beginn" name="clockIn" type="time" defaultValue={berlinTime(inAt)} />
                      <Field label="Ende" name="clockOut" type="time" defaultValue={outAt ? berlinTime(outAt) : ""} hint="vor Beginn = nächster Tag" />
                      <Field label="Pause (Min.)" name="breakMinutes" type="number" min={0} defaultValue={currentBreak} />
                    </div>
                    <Field label="Grund (Pflicht)" name="reason" required />
                    {s.plannedStartAt && inAt < s.plannedStartAt && (
                      <div className="rounded-lg border border-line px-3 py-2">
                        <input type="hidden" name="earlyPresent" value="1" />
                        <Check label={`Früher Beginn genehmigt – Zeit zählt ab ${berlinTime(inAt)} statt ab Dienstbeginn ${berlinTime(s.plannedStartAt)}`} name="early" defaultChecked={s.earlyStartApproved} />
                        {!s.earlyStartApproved && <p className="text-xs text-warn">Ohne Haken bleiben {Math.round((s.plannedStartAt.getTime() - inAt.getTime()) / 60000)} Min. vor Dienstbeginn unvergütet.</p>}
                      </div>
                    )}
                    <Check label="Fehlbuchung – Schicht zählt nicht" name="void" />
                  </ActionForm>
                )}
              </div>
            </details>
          );
        })}
        {!rows.length && <p className="text-mute">Keine Buchungen im Zeitraum.</p>}
      </div>
      <p className="text-xs text-mute">* korrigierter Wert</p>
    </div>
  );
}
