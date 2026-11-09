import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { currentDeptFilter, matchesFilter } from "@/lib/dept";
import { loadMonth } from "@/lib/month-data";
import { berlinDate, dbDate, fmtMinutes } from "@/lib/time";

const signed = (m: number) => `${m > 0 ? "+" : ""}${fmtMinutes(m)}`;
const label = (d: Date) => d.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function StundenkontenPage() {
  await requireAdmin("employees.view");
  const today = berlinDate(new Date());
  const filter = await currentDeptFilter();
  const emps = await prisma.employee.findMany({
    where: { active: true, contracts: { some: { payModel: "SALARIED", validFrom: { lte: dbDate(today) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(today) } }] } } },
    include: { primaryDept: { include: { parent: true } }, account: { include: { transactions: { select: { minutes: true } } } }, monthlyClosings: { where: { status: "CLOSED" }, orderBy: { month: "desc" }, take: 1 } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const rows = await Promise.all(emps.filter((e) => matchesFilter(filter, e.primaryDept)).map(async (e) => ({ e, balance: e.account?.transactions.reduce((a, t) => a + t.minutes, 0) ?? 0, cur: await loadMonth(prisma, e.id, today.slice(0, 7)) })));
  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-3xl font-semibold">Stundenkonten</h1>
      <p className="text-mute">Kontostand = Anfangsbestand + abgeschlossene Monate + Auszahlungen und Korrekturen. Der laufende Monat zählt erst mit dem Monatsabschluss.</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-coal">
        <table className="w-full min-w-[720px] text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="px-4 py-3">MITARBEITER</th><th>KONTOSTAND</th><th>LETZTER ABSCHLUSS</th><th>LAUFENDER MONAT BISHER</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ e, balance, cur }) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-4 py-3"><span className="font-semibold">{e.firstName} {e.lastName}</span><span className="block text-xs text-mute">{e.primaryDept.name}</span></td>
                <td className={`text-lg font-bold ${balance < 0 ? "text-bad" : balance > 0 ? "text-good" : ""}`}>{signed(balance)}</td>
                <td>{e.monthlyClosings[0] ? <>{label(e.monthlyClosings[0].month)}<span className="block text-xs text-mute">Konto {signed(e.monthlyClosings[0].accountChangeMinutes)}</span></> : <span className="text-mute">noch keiner</span>}</td>
                <td>{fmtMinutes(cur.actual)} <span className="text-mute">von {fmtMinutes(cur.target)} Soll</span></td>
                <td className="pr-4 text-right"><Link href={`/admin/stundenkonten/${e.id}`} className="rounded-lg border border-line px-3 py-2 hover:bg-slate">Details</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-4 py-6 text-mute">Keine Festangestellten in dieser Abteilung.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
