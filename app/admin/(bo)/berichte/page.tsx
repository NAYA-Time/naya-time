import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { currentDeptFilter } from "@/lib/dept";
import { prevMonth } from "@/lib/calc/month";
import { dateDe } from "@/lib/labels";
import { berlinDate } from "@/lib/time";
import { Section } from "@/components/Select";

const TYPE: Record<string, string> = { WEEKLY: "Wochenbericht", MONTHLY: "Monatsbericht", PAYROLL_HOURLY: "Aushilfenabrechnung" };
const DEPT: Record<string, string> = { ALL: "Alle", KUECHE: "Küche", SERVICE: "Service" };
const input = "min-h-12 rounded-xl border border-line bg-ink px-4 text-base text-paper";
const btn = "min-h-12 rounded-xl bg-gold px-5 font-semibold text-ink";

function DeptSelect({ value }: { value: string }) {
  return (
    <label className="grid gap-1.5 text-sm text-mute">Abteilung
      <select name="abteilung" defaultValue={value} className={input}>{Object.entries(DEPT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );
}

export default async function BerichtePage() {
  const admin = await requireAdmin("reports.create");
  const filter = await currentDeptFilter();
  const today = berlinDate(new Date());
  const lastWeek = new Date(Date.parse(today + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  const canWages = admin.permissions.has("wages.view");
  const [periods, reports] = await Promise.all([
    canWages ? prisma.payrollPeriod.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 12 }) : [],
    prisma.generatedReport.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { deliveries: true } }),
  ]);
  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-3xl font-semibold">Berichte</h1>
      <p className="text-mute">Excel-Dateien mit Übersicht, Tageswerten, Abwesenheiten und Hinweisen. Zeiten sind echte Excel-Zeitwerte, man kann damit weiterrechnen.</p>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Wochenbericht">
          <form action="/admin/berichte/erstellen" className="grid gap-4">
            <input type="hidden" name="typ" value="woche" />
            <label className="grid gap-1.5 text-sm text-mute">Ein Tag der Woche<input type="date" name="woche" defaultValue={lastWeek} className={input} /></label>
            <DeptSelect value={filter} />
            <button className={btn}>Excel herunterladen</button>
          </form>
        </Section>
        <Section title="Monatsbericht" hint="Festangestellte mit Stundenkonto, Aushilfen mit Stunden und rechnerischem Brutto.">
          <form action="/admin/berichte/erstellen" className="grid gap-4">
            <input type="hidden" name="typ" value="monat" />
            <label className="grid gap-1.5 text-sm text-mute">Monat<input type="month" name="monat" defaultValue={prevMonth(today.slice(0, 7))} className={input} /></label>
            <DeptSelect value={filter} />
            <button className={btn}>Excel herunterladen</button>
          </form>
        </Section>
        {canWages && (
          <Section title="Aushilfenabrechnung">
            {periods.length ? (
              <form action="/admin/berichte/erstellen" className="grid gap-4">
                <input type="hidden" name="typ" value="aushilfen" />
                <label className="grid gap-1.5 text-sm text-mute">Abrechnungslauf
                  <select name="lauf" className={input}>{periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                </label>
                <button className={btn}>Excel herunterladen</button>
              </form>
            ) : <p className="text-mute">Noch keine Abrechnung.</p>}
          </Section>
        )}
      </div>
      <Section title="Zuletzt erstellt">
        <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="py-2">ERSTELLT</th><th>BERICHT</th><th>ZEITRAUM</th><th>VERSAND</th><th></th></tr></thead>
          <tbody>
            {reports.filter((r) => canWages || r.reportType !== "PAYROLL_HOURLY").map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-2">{r.createdAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}{!r.createdById && <span className="ml-1 text-xs text-mute">automatisch</span>}</td>
                <td>{TYPE[r.reportType]} · {DEPT[r.deptFilter]}</td>
                <td>{dateDe(r.periodStart)}{r.periodEnd.getTime() !== r.periodStart.getTime() && ` – ${dateDe(r.periodEnd)}`}</td>
                <td className="text-xs">{r.deliveries.length ? `${r.deliveries.filter((d) => d.status === "SENT").length}/${r.deliveries.length} gesendet` : "–"}</td>
                <td className="text-right"><a href={`/admin/berichte/datei/${r.id}`} className="rounded-lg border border-line px-3 py-2 hover:bg-slate">Herunterladen</a></td>
              </tr>
            ))}
            {!reports.length && <tr><td colSpan={5} className="py-3 text-mute">Noch keine Berichte.</td></tr>}
          </tbody>
        </table></div>
      </Section>
    </div>
  );
}
