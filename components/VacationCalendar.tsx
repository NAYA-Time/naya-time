// Darstellung der Urlaubsübersicht (Monat). Gold = Urlaub, gestrichelt = Antrag offen, rot = Überschneidung.
import { DEPT_LABEL, isWeekend, type Calendar, type CalRow, type DeptKey } from "@/lib/calc/vacation-calendar";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmt = (n: number) => n.toLocaleString("de-DE");

function Head({ days, today, label }: { days: string[]; today: string; label: string }) {
  return (
    <thead>
      <tr className="text-[11px] text-mute">
        <th className="sticky left-0 z-10 min-w-44 bg-coal px-2 py-1 text-left font-normal">{label}</th>
        {days.map((d) => (
          <th key={d} className={`w-7 min-w-7 px-0 py-1 text-center font-normal ${isWeekend(d) ? "bg-slate/60" : ""} ${d === today ? "text-gold" : ""}`}>
            <span className="block">{WD[new Date(d + "T12:00:00Z").getUTCDay()]}</span><span className="block tabular text-paper">{Number(d.slice(8))}</span>
          </th>
        ))}
        <th className="px-2 text-right font-normal">TAGE</th>
      </tr>
    </thead>
  );
}

function Row({ r, days, count, dept }: { r: CalRow; days: string[]; count: Record<string, number>; dept?: DeptKey }) {
  return (
    <tr className="border-t border-line">
      <td className="sticky left-0 z-10 bg-coal px-2 py-1 text-sm whitespace-nowrap">{r.emp.name}{dept && <span className="ml-1 text-xs text-mute">{DEPT_LABEL[dept]}</span>}</td>
      {days.map((d) => {
        const m = r.cells[d], clash = m && count[d] >= 2;
        return (
          <td key={d} className={`p-0.5 ${isWeekend(d) ? "bg-slate/40" : ""}`}>
            {m === "U" && <span title={clash ? "Überschneidung" : "Urlaub"} className={`block h-6 rounded ${clash ? "bg-bad" : "bg-gold"}`} />}
            {m === "A" && <span title={clash ? "Antrag, Überschneidung" : "Antrag offen"} className={`block h-6 rounded border-2 border-dashed ${clash ? "border-bad bg-bad/20" : "border-warn bg-warn/10"}`} />}
          </td>
        );
      })}
      <td className="px-2 text-right text-sm tabular whitespace-nowrap">{fmt(r.vacDays)}{r.requestedDays ? <span className="text-warn"> +{r.requestedDays}</span> : null}</td>
    </tr>
  );
}

function CountRow({ days, count, label, tone = "text-bad" }: { days: string[]; count: Record<string, number>; label: string; tone?: string }) {
  return (
    <tr className="border-t-2 border-line text-xs">
      <td className="sticky left-0 z-10 bg-coal px-2 py-1 text-mute">{label}</td>
      {days.map((d) => <td key={d} className={`text-center tabular ${count[d] >= 2 ? `font-bold ${tone}` : count[d] ? "text-paper" : "text-mute/50"}`}>{count[d] || "·"}</td>)}
      <td />
    </tr>
  );
}

/** Eine Abteilung */
export function DeptCalendar({ cal, dept, today }: { cal: Calendar; dept: DeptKey; today: string }) {
  const g = cal.groups.find((x) => x.dept === dept);
  if (!g) return <p className="text-mute">Keine Mitarbeiter.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse">
        <Head days={cal.days} today={today} label="MITARBEITER" />
        <tbody>
          {g.rows.map((r) => <Row key={r.emp.id} r={r} days={cal.days} count={g.count} />)}
          <CountRow days={cal.days} count={g.count} label="Im Urlaub" />
        </tbody>
      </table>
    </div>
  );
}

/** Gesamt: alle, nur wer im Monat Urlaub hat oder beantragt, plus Zählzeilen je Abteilung */
export function TotalCalendar({ cal, today }: { cal: Calendar; today: string }) {
  const rows = cal.groups.flatMap((g) => g.rows.filter((r) => r.vacDays || r.requestedDays || Object.keys(r.cells).length).map((r) => ({ r, g })));
  if (!rows.length) return <p className="text-mute">In diesem Monat hat niemand Urlaub.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse">
        <Head days={cal.days} today={today} label="ALLE MIT URLAUB" />
        <tbody>
          {rows.map(({ r, g }) => <Row key={r.emp.id} r={r} days={cal.days} count={g.count} dept={g.dept} />)}
          {cal.groups.map((g) => <CountRow key={g.dept} days={cal.days} count={g.count} label={`davon ${DEPT_LABEL[g.dept]}`} />)}
          <CountRow days={cal.days} count={cal.total} label="Gesamt im Urlaub" tone="text-warn" />
        </tbody>
      </table>
    </div>
  );
}
