import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { closeAll, closeMonth, correctClosing } from "@/lib/admin-actions-closing";
import { monthBounds, prevMonth, type Decision, type MonthResult } from "@/lib/calc/month";
import { currentDeptFilter, matchesEmp } from "@/lib/dept";
import { loadMonth } from "@/lib/month-data";
import { berlinDate, dbDate, fmtMinutes } from "@/lib/time";
import { ActionForm, Field } from "@/components/ActionForm";
import { Section, Select } from "@/components/Select";

const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const label = (m: string) => new Date(m + "-15T12:00:00Z").toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });
const signed = (m: number) => `${m > 0 ? "+" : ""}${fmtMinutes(m)}`;
const DECISION_LABEL: Record<string, string> = { NONE: "–", PENDING: "offen", AUTO_BOOKED: "automatisch Minusstunden", EMPLOYEE_CAUSED: "Minusstunden (Mitarbeiter)", EMPLOYER_CAUSED: "keine Minusstunden (Betrieb)" };

export default async function MonatsabschlussPage({ searchParams }: { searchParams: Promise<{ monat?: string }> }) {
  const admin = await requireAdmin("employees.view");
  const sp = await searchParams;
  const today = berlinDate(new Date());
  const month = /^\d{4}-\d{2}$/.test(sp.monat ?? "") ? sp.monat! : prevMonth(today.slice(0, 7));
  const { first, last } = monthBounds(month);
  const filter = await currentDeptFilter();
  const canClose = admin.permissions.has("closing.manage");

  const emps = await prisma.employee.findMany({
    where: { entryDate: { lte: dbDate(last) }, OR: [{ exitDate: null }, { exitDate: { gte: dbDate(first) } }], contracts: { some: { payModel: "SALARIED", validFrom: { lte: dbDate(last) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(first) } }] } } },
    include: { primaryDept: { include: { parent: true } }, monthlyClosings: { where: { month: dbDate(first) }, orderBy: { version: "desc" } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const visible = emps.filter((e) => matchesEmp(filter, e));
  const rows = await Promise.all(visible.map(async (e) => {
    const active = e.monthlyClosings.find((c) => c.status === "CLOSED");
    // Live-Rechnung mit der beim Abschluss gewählten Defizit-Behandlung, damit der Vergleich fair ist
    const d = active && ["AUTO_BOOKED", "EMPLOYEE_CAUSED", "EMPLOYER_CAUSED"].includes(active.deficitDecision) ? (active.deficitDecision as Decision) : undefined;
    const r = await loadMonth(prisma, e.id, month, d);
    if (!active) {
      // Reihenfolge wie beim Abschließen selbst: lückenlos, kein Monat vor einem schon abgeschlossenen
      const months = (await prisma.monthlyTimeClosing.findMany({ where: { employeeId: e.id, status: "CLOSED" }, select: { month: true } })).map((c) => c.month.toISOString().slice(0, 7));
      if (months.some((m) => m > month)) r.blockers.push("Ein späterer Monat ist schon abgeschlossen");
      else if (months.some((m) => m < month) && !months.includes(prevMonth(month))) r.blockers.push(`Erst ${label(prevMonth(month))} abschließen`);
    }
    return { e, active, history: e.monthlyClosings.filter((c) => c.status === "SUPERSEDED"), r };
  }));
  const ready = rows.filter((x) => !x.active && !x.r.blockers.length);

  return (
    <div className="grid max-w-6xl gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Monatsabschluss {label(month)}</h1>
          <p className="mt-1 text-mute">Festangestellte. Minusstunden werden automatisch gebucht und als „aus Vormonaten“ übertragen. Aushilfen folgen in der Aushilfenabrechnung.</p>
        </div>
        <nav className="flex gap-2">
          <Link href={`/admin/monatsabschluss?monat=${prevMonth(month)}`} className="rounded-xl border border-line px-4 py-3 hover:bg-slate">← Vormonat</Link>
          <Link href={`/admin/monatsabschluss?monat=${nextMonth(month)}`} className="rounded-xl border border-line px-4 py-3 hover:bg-slate">Nächster →</Link>
        </nav>
      </div>

      {canClose && ready.length > 1 && (
        <Section title={`${ready.length} Mitarbeiter bereit`} hint="Schließt alle ohne Hindernisse ab. Defizite werden dabei automatisch als Minusstunden gebucht.">
          <ActionForm action={closeAll} submit={`Alle ${ready.length} abschließen`}>
            <input type="hidden" name="month" value={month} />
            <input type="hidden" name="ids" value={ready.map((x) => x.e.id).join(",")} />
          </ActionForm>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ e, active, history, r }) => {
          const shown = active ? fromClosing(active, r) : r;
          const changed = active && (r.accountChange !== active.accountChangeMinutes || r.actual !== active.workedMinutes + active.sickCreditMinutes + active.vacationCreditMinutes + active.holidayCreditMinutes + active.otherCreditMinutes);
          return (
            <section key={e.id} className="rounded-2xl border border-line bg-coal p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{e.firstName} {e.lastName}</h2>
                  <p className="text-sm text-mute">{e.primaryDept.name}</p>
                </div>
                {active ? <span className="rounded-full bg-good/15 px-3 py-1 text-sm text-good">abgeschlossen{active.version > 1 ? ` · Version ${active.version}` : ""}</span>
                  : r.blockers.length ? <span className="rounded-full bg-warn/15 px-3 py-1 text-sm text-warn">nicht bereit</span>
                  : <span className="rounded-full bg-slate px-3 py-1 text-sm text-mute">bereit</span>}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm tabular sm:grid-cols-4">
                <Num k="Soll" v={fmtMinutes(shown.target)} />
                <Num k="Gearbeitet" v={fmtMinutes(shown.worked)} />
                <Num k="Krank" v={fmtMinutes(shown.sick)} />
                <Num k="Urlaub" v={fmtMinutes(shown.vacation)} />
                <Num k="Feiertag" v={fmtMinutes(shown.holiday)} />
                <Num k="Sonstiges" v={fmtMinutes(shown.other)} />
                <Num k="Ist gesamt" v={fmtMinutes(shown.actual)} strong />
                <Num k="Differenz" v={signed(shown.diff)} strong tone={shown.diff < 0 ? "bad" : shown.diff > 0 ? "good" : undefined} />
              </dl>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-line pt-3 text-sm tabular sm:grid-cols-4">
                {shown.overtime > 0 && <Num k="Davon abgegolten" v={fmtMinutes(shown.included)} />}
                {shown.deficit > 0 && <Num k="Defizit" v={DECISION_LABEL[shown.decision]} />}
                <Num k="Aus Vormonaten" v={signed(shown.balanceBefore)} tone={shown.balanceBefore < 0 ? "bad" : undefined} />
                <Num k="Aufs Konto" v={signed(shown.accountChange)} />
                <Num k="Neuer Stand" v={signed(shown.balanceAfter)} strong tone={shown.balanceAfter < 0 ? "bad" : shown.balanceAfter > 0 ? "good" : undefined} />
              </dl>
              {shown.timeOff > 0 && <p className="mt-2 text-xs text-mute">Darin {fmtMinutes(shown.timeOff)} Freizeitausgleich, vom Konto abgebucht.</p>}

              {!active && r.blockers.map((b) => <p key={b} className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">{b}</p>)}
              {r.hints.map((h) => <p key={h} className="mt-3 text-sm text-warn">⚠ {h}</p>)}
              {changed && <p className="mt-3 text-sm text-warn">⚠ Die Daten haben sich seit dem Abschluss geändert (neu gerechnet: Konto {signed(r.accountChange)}). Bei Bedarf korrigieren.</p>}
              {active?.correctionReason && <p className="mt-2 text-xs text-mute">Korrekturgrund: {active.correctionReason}</p>}
              {history.length > 0 && <p className="mt-1 text-xs text-mute">Frühere Versionen: {history.map((h) => `V${h.version} (Konto ${signed(h.accountChangeMinutes)})`).join(", ")}</p>}

              {canClose && !active && !r.blockers.length && (
                <div className="mt-4">
                  <ActionForm action={closeMonth} submit="Monat abschließen">
                    <input type="hidden" name="employeeId" value={e.id} />
                    <input type="hidden" name="month" value={month} />
                    {r.deficit > 0 && <Select label={`Defizit ${fmtMinutes(r.deficit)} – wie behandeln?`} name="decision" defaultValue="AUTO_BOOKED" options={[["AUTO_BOOKED", "Als Minusstunden übertragen (Standard)"], ["EMPLOYER_CAUSED", "Vom Betrieb verursacht – keine Minusstunden"]]} />}
                  </ActionForm>
                </div>
              )}
              {canClose && active && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gold">Korrigieren …</summary>
                  <div className="mt-3">
                    <ActionForm action={correctClosing} submit="Neu berechnen und korrigieren">
                      <input type="hidden" name="closingId" value={active.id} />
                      <Field label="Grund der Korrektur" name="reason" required />
                      {r.deficit > 0 && <Select label="Defizit behandeln" name="decision" defaultValue={active.deficitDecision === "EMPLOYER_CAUSED" ? "EMPLOYER_CAUSED" : "AUTO_BOOKED"} options={[["AUTO_BOOKED", "Als Minusstunden übertragen"], ["EMPLOYER_CAUSED", "Vom Betrieb verursacht – keine Minusstunden"]]} />}
                    </ActionForm>
                  </div>
                </details>
              )}
            </section>
          );
        })}
        {!rows.length && <p className="text-mute">Keine Festangestellten in diesem Monat.</p>}
      </div>
    </div>
  );
}

type Closing = { targetMinutes: number; workedMinutes: number; sickCreditMinutes: number; vacationCreditMinutes: number; holidayCreditMinutes: number; otherCreditMinutes: number; overtimeMinutes: number; includedOvertimeMinutes: number; compensableMinutes: number; deficitMinutes: number; deficitDecision: string; minusMinutesBooked: number; accountChangeMinutes: number; balanceBeforeMinutes: number; balanceAfterMinutes: number; ruleSnapshot: unknown };
/** Gespeicherter Abschluss in derselben Form wie die Live-Rechnung (gezeigt wird immer der gespeicherte Stand) */
function fromClosing(c: Closing, live: MonthResult): MonthResult {
  const actual = c.workedMinutes + c.sickCreditMinutes + c.vacationCreditMinutes + c.holidayCreditMinutes + c.otherCreditMinutes;
  return {
    ...live, target: c.targetMinutes, worked: c.workedMinutes, sick: c.sickCreditMinutes, vacation: c.vacationCreditMinutes, holiday: c.holidayCreditMinutes, other: c.otherCreditMinutes,
    timeOff: Number((c.ruleSnapshot as { timeOffMinutes?: number } | null)?.timeOffMinutes ?? 0), actual, diff: actual - c.targetMinutes,
    overtime: c.overtimeMinutes, included: c.includedOvertimeMinutes, compensable: c.compensableMinutes, deficit: c.deficitMinutes, decision: c.deficitDecision as MonthResult["decision"],
    minusBooked: c.minusMinutesBooked, accountChange: c.accountChangeMinutes, balanceBefore: c.balanceBeforeMinutes, balanceAfter: c.balanceAfterMinutes,
  };
}

function Num({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="text-xs text-mute">{k}</dt>
      <dd className={`${strong ? "text-base font-bold" : ""} ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{v}</dd>
    </div>
  );
}
