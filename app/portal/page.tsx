// Mein NAYA – Handy-Portal. Kein Stempeln. Nur freigegebene Bereiche, Stunden nur laufende Woche und laufender Monat.
import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { portalOverview } from "@/lib/portal";
import { currentPortalEmployee, portalLogoutAction, requestVacationAction, withdrawRequestAction } from "@/lib/portal-actions";
import { berlinDate, fmtMinutes } from "@/lib/time";

export const metadata = { title: "Mein NAYA" };
export const dynamic = "force-dynamic";

const de = (ymd: string) => ymd.split("-").reverse().join(".");
const span = (a: string, b: string) => (a === b ? de(a) : `${de(a)} – ${de(b)}`);
const signed = (m: number) => `${m > 0 ? "+" : m < 0 ? "−" : ""}${fmtMinutes(Math.abs(m))}`;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const REQ: Record<string, [string, string]> = { OPEN: ["wartet auf Entscheidung", "text-warn"], APPROVED: ["genehmigt", "text-good"], REJECTED: ["abgelehnt", "text-bad"], WITHDRAWN: ["zurückgezogen", "text-mute"] };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-coal p-4"><h2 className="mb-3 text-sm tracking-[0.2em] text-mute">{title}</h2>{children}</section>;
}

export default async function Portal() {
  const me = await currentPortalEmployee();
  if (!me) redirect("/portal/anmelden");
  const o = await portalOverview(me.id, me.show);
  const today = berlinDate(new Date());
  const nothing = !Object.values(me.show).some(Boolean);
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg content-start gap-4 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/naya-logo.svg" alt="NAYA" className="h-9 w-auto" />
          <p className="mt-1 truncate text-lg">Hallo {me.firstName}</p>
        </div>
        <form action={portalLogoutAction}><button className="min-h-11 rounded-xl border border-line px-4 text-sm">Abmelden</button></form>
      </header>

      {nothing && <p className="rounded-2xl border border-line bg-coal p-4 text-mute">Für dich ist noch nichts freigeschaltet. Bitte bei der Leitung melden.</p>}

      {o.changes.length > 0 && (
        <div role="alert" className="rounded-2xl border-2 border-info bg-info/15 p-4 text-info">
          <p className="font-semibold">Dein Dienstplan wurde geändert</p>
          <ul className="mt-1 text-sm">{o.changes.map((c) => <li key={c} className="tabular">{c}</li>)}</ul>
        </div>
      )}

      {o.balance !== null && o.balance < 0 && (
        <p role="alert" className="rounded-2xl border-2 border-bad bg-bad/15 p-4 text-lg font-semibold text-bad">Stundenkonto im Minus: {signed(o.balance)} Std. (bis gestern)</p>
      )}

      {o.plan && o.plan.map((w) => (
        <Card key={w.title} title={`${w.title.toUpperCase()} · ${w.range}`}>
          {!w.published && <p className="mb-2 text-sm text-warn">Noch nicht veröffentlicht – kann sich ändern.</p>}
          <ul className="grid gap-1">
            {w.days.map((d) => (
              <li key={d.label} className={`rounded-xl px-3 py-2 ${d.change ? "bg-info/15 text-info ring-2 ring-info" : d.today ? "bg-gold/15 text-gold" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="tabular">{d.label}</span>
                  <span className="text-right tabular">{d.shifts.length ? d.shifts.join(", ") : d.absence ?? <span className={d.change ? "" : "text-mute"}>frei</span>}{d.shifts.length > 0 && d.absence ? ` · ${d.absence}` : ""}</span>
                </div>
                {d.change && <p className="text-right text-xs font-semibold">Änderung: {d.change}</p>}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {(o.week || o.weekTarget !== null && me.show.weeklyTarget || o.month || (o.balance !== null && me.show.accountBalance)) && (
        <Card title="DEINE STUNDEN">
          <dl className="grid grid-cols-2 gap-3 text-center">
            {o.week && <div className="rounded-xl bg-ink p-3"><dt className="text-xs text-mute">DIESE WOCHE</dt><dd className="mt-1 text-2xl tabular">{fmtMinutes(o.week.worked)}</dd>{me.show.weeklyTarget && o.weekTarget ? <dd className="text-xs text-mute">von {fmtMinutes(o.weekTarget)} Soll</dd> : null}</div>}
            {!o.week && me.show.weeklyTarget && o.weekTarget ? <div className="rounded-xl bg-ink p-3"><dt className="text-xs text-mute">WOCHENSOLL</dt><dd className="mt-1 text-2xl tabular">{fmtMinutes(o.weekTarget)}</dd></div> : null}
            {o.month && (o.month.worked !== null || o.month.target !== null) && (
              <div className="rounded-xl bg-ink p-3"><dt className="text-xs text-mute">{MONTHS[Number(o.month.label.slice(5)) - 1].toUpperCase()}</dt>
                {o.month.worked !== null && <dd className="mt-1 text-2xl tabular">{fmtMinutes(o.month.worked)}</dd>}
                {o.month.target !== null && <dd className={o.month.worked !== null ? "text-xs text-mute" : "mt-1 text-2xl tabular"}>{o.month.worked !== null ? `von ${fmtMinutes(o.month.target)} Soll` : fmtMinutes(o.month.target)}</dd>}
              </div>
            )}
            {o.balance !== null && me.show.accountBalance && <div className="col-span-2 rounded-xl bg-ink p-3"><dt className="text-xs text-mute">STUNDENKONTO (BIS GESTERN)</dt><dd className={`mt-1 text-2xl font-semibold tabular ${o.balance < 0 ? "text-bad" : o.balance > 0 ? "text-good" : ""}`}>{signed(o.balance)}</dd></div>}
          </dl>
          {o.week?.open && <p className="mt-2 text-xs text-mute">Die laufende Schicht zählt erst nach dem Ausstempeln.</p>}
          <p className="mt-2 text-xs text-mute">Gezeigt werden nur die laufende Woche und der laufende Monat.</p>
        </Card>
      )}

      {o.vacation && (
        <Card title={`URLAUB ${o.vacation.year}`}>
          <p className="text-2xl">noch <span className="font-semibold text-gold">{o.vacation.rest.toLocaleString("de-DE")} Tage</span></p>
          <p className="text-sm text-mute">Anspruch {o.vacation.entitlement.toLocaleString("de-DE")} · genommen {o.vacation.taken.toLocaleString("de-DE")}{o.vacation.planned ? ` · geplant ${o.vacation.planned.toLocaleString("de-DE")}` : ""}</p>
          {o.vacation.carryOpen ? <p className="mt-1 text-sm text-warn">Davon {o.vacation.carryOpen.toLocaleString("de-DE")} Tage aus dem Vorjahr – bitte bis {o.vacation.carryExpires ? de(o.vacation.carryExpires) : "31.03."} nehmen.</p> : null}
          {o.approved.length > 0 && (
            <div className="mt-3"><p className="text-sm text-mute">Genehmigter Urlaub</p>
              <ul className="mt-1 grid gap-1">{o.approved.map((a) => <li key={a.from} className="flex justify-between rounded-xl bg-ink px-3 py-2 tabular"><span>{span(a.from, a.to)}</span><span className="text-good">{a.days.toLocaleString("de-DE")} {a.days === 1 ? "Tag" : "Tage"}</span></li>)}</ul>
            </div>
          )}
        </Card>
      )}

      {me.show.vacationRequests && (
        <Card title="URLAUB BEANTRAGEN">
          {o.requests.length > 0 && (
            <ul className="mb-4 grid gap-1">{o.requests.map((r) => (
              <li key={r.id} className="rounded-xl bg-ink px-3 py-2">
                <div className="flex items-center justify-between gap-2"><span className="tabular">{span(r.from, r.to)}</span><span className={`text-sm ${REQ[r.status][1]}`}>{REQ[r.status][0]}</span></div>
                {r.decisionNote && <p className="text-xs text-mute">{r.decisionNote}</p>}
                {r.status === "OPEN" && <form action={withdrawRequestAction} className="mt-1 text-right"><input type="hidden" name="id" value={r.id} /><button className="text-xs text-mute underline">zurückziehen</button></form>}
              </li>
            ))}</ul>
          )}
          <ActionForm action={requestVacationAction} submit="Antrag senden">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Von" name="from" type="date" defaultValue={today} required />
              <Field label="Bis" name="to" type="date" defaultValue={today} required />
            </div>
            <Field label="Bemerkung (freiwillig)" name="note" />
          </ActionForm>
        </Card>
      )}
      <p className="text-center text-xs text-mute">Stempeln geht nur am iPad im Restaurant.</p>
    </main>
  );
}
