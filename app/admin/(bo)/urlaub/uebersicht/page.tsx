// Urlaubsübersicht: Monat (Küche, Service, Gesamt mit Überschneidungen) und Jahr, jeweils als PDF.
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { loadVacationData } from "@/lib/vacation-calendar";
import { buildCalendar, DEPT_LABEL, DEPT_ORDER, monthRange, yearTable } from "@/lib/calc/vacation-calendar";
import { DeptCalendar, TotalCalendar } from "@/components/VacationCalendar";
import { Section } from "@/components/Select";
import { berlinDate } from "@/lib/time";

export const dynamic = "force-dynamic";
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const de = (ymd: string) => `${ymd.slice(8)}.${ymd.slice(5, 7)}.`;
const shift = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const fmt = (n: number) => (n ? n.toLocaleString("de-DE") : "–");
const btn = "inline-flex min-h-11 items-center rounded-xl border border-line px-4 hover:bg-slate";

export default async function Uebersicht({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin("employees.view");
  const sp = await searchParams;
  const today = berlinDate(new Date());
  const year = /^\d{4}$/.test(sp.jahr ?? "") ? Number(sp.jahr) : null;
  const month = /^\d{4}-\d{2}$/.test(sp.monat ?? "") ? sp.monat! : today.slice(0, 7);

  const tabs = (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/admin/urlaub/uebersicht?monat=${year ? `${year}-${today.slice(5, 7)}` : month}`} className={`${btn} ${!year ? "border-gold text-gold" : ""}`}>Monat</Link>
      <Link href={`/admin/urlaub/uebersicht?jahr=${year ?? month.slice(0, 4)}`} className={`${btn} ${year ? "border-gold text-gold" : ""}`}>Jahr</Link>
      <Link href="/admin/urlaub" className="ml-auto text-sm text-gold">← Urlaub eintragen und Anträge</Link>
    </div>
  );
  const legend = (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-mute">
      <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-5 rounded bg-gold" />Urlaub</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-5 rounded border-2 border-dashed border-warn" />Antrag offen</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-5 rounded bg-bad" />Überschneidung (2 oder mehr aus derselben Abteilung)</span>
    </p>
  );

  if (year) {
    const { emps, entries } = await loadVacationData(`${year}-01-01`, `${year}-12-31`);
    const y = yearTable(emps, entries, year);
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <h1 className="text-3xl font-semibold">Urlaubsübersicht {year}</h1>
        {tabs}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`?jahr=${year - 1}`} className={btn}>‹ {year - 1}</Link>
          <Link href={`?jahr=${year + 1}`} className={btn}>{year + 1} ›</Link>
          <a href={`/admin/urlaub/uebersicht/pdf?jahr=${year}`} className="ml-auto inline-flex min-h-11 items-center rounded-xl bg-gold px-5 font-semibold text-ink">Jahr als PDF</a>
        </div>
        <p className="text-sm text-mute">Urlaubstage je Monat nach Anrechnung (halbe Tage möglich). <span className="text-warn">+ Zahl</span> = beantragte Kalendertage, noch nicht entschieden.</p>
        {y.groups.map((g) => (
          <Section key={g.dept} title={DEPT_LABEL[g.dept]}>
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm tabular">
              <thead className="text-xs text-mute"><tr><th className="py-2 text-left">MITARBEITER</th>{y.months.map((m, i) => <th key={m} className="text-right"><Link href={`?monat=${m}`} className="hover:text-gold">{MONTHS[i].slice(0, 3)}</Link></th>)}<th className="pl-3 text-right">GESAMT</th></tr></thead>
              <tbody>{g.rows.map((r) => (
                <tr key={r.emp.id} className="border-t border-line">
                  <td className="py-1.5 whitespace-nowrap">{r.emp.name}</td>
                  {r.months.map((m, i) => <td key={i} className={`text-right ${m.vac ? "text-paper" : "text-mute/50"}`}>{fmt(m.vac)}{m.req ? <span className="text-warn"> +{m.req}</span> : null}</td>)}
                  <td className="pl-3 text-right font-semibold">{fmt(r.vacDays)}{r.requestedDays ? <span className="font-normal text-warn"> +{r.requestedDays}</span> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Section>
        ))}
        <Overlaps list={y.overlaps} />
      </div>
    );
  }

  const { from, to } = monthRange(month);
  const { emps, entries } = await loadVacationData(from, to);
  const cal = buildCalendar(emps, entries, from, to);
  const title = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <h1 className="text-3xl font-semibold">Urlaubsübersicht {title}</h1>
      {tabs}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`?monat=${shift(month, -1)}`} className={btn}>‹ Vormonat</Link>
        <Link href={`?monat=${today.slice(0, 7)}`} className={btn}>Heute</Link>
        <Link href={`?monat=${shift(month, 1)}`} className={btn}>Nächster Monat ›</Link>
        <a href={`/admin/urlaub/uebersicht/pdf?monat=${month}`} className="ml-auto inline-flex min-h-11 items-center rounded-xl bg-gold px-5 font-semibold text-ink">Monat als PDF</a>
      </div>
      {legend}
      <Overlaps list={cal.overlaps} />
      {DEPT_ORDER.filter((d) => cal.groups.some((g) => g.dept === d)).map((d) => (
        <Section key={d} title={DEPT_LABEL[d]}><DeptCalendar cal={cal} dept={d} today={today} /></Section>
      ))}
      <Section title="Gesamt" hint="Alle, die in diesem Monat Urlaub haben oder beantragt haben, mit Zählung je Abteilung und gesamt."><TotalCalendar cal={cal} today={today} /></Section>
    </div>
  );
}

function Overlaps({ list }: { list: { from: string; to: string; dept: keyof typeof DEPT_LABEL; names: string[] }[] }) {
  if (!list.length) return <p className="rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-good">Keine Überschneidungen innerhalb einer Abteilung.</p>;
  return (
    <div className="rounded-xl border border-bad/50 bg-bad/10 px-4 py-3">
      <p className="font-semibold text-bad">Überschneidungen ({list.length})</p>
      <ul className="mt-1 grid gap-0.5 text-sm">{list.map((o) => (
        <li key={o.from + o.dept + o.names.join()}><span className="tabular">{o.from === o.to ? de(o.from) : `${de(o.from)} – ${de(o.to)}`}{o.from.slice(0, 4)}</span> · {DEPT_LABEL[o.dept]}: {o.names.join(", ")}</li>
      ))}</ul>
    </div>
  );
}
