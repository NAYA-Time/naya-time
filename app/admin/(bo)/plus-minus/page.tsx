// Plus/Minus aller Festangestellten auf einen Blick – nur für den Inhaber (Gunnar 09.11.2026).
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { runningBalance } from "@/lib/month-data";
import { berlinDate, dbDate, fmtMinutes } from "@/lib/time";

const signed = (m: number) => `${m > 0 ? "+" : m < 0 ? "−" : ""}${fmtMinutes(Math.abs(m))}`;

export default async function PlusMinusPage() {
  const admin = await requireAdmin();
  if (admin.roleKey !== "OWNER") redirect("/admin?kein-recht=inhaber");
  const today = berlinDate(new Date());
  const y = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  const emps = await prisma.employee.findMany({
    where: { active: true, contracts: { some: { payModel: "SALARIED", validFrom: { lte: dbDate(today) }, OR: [{ validTo: null }, { validTo: { gte: dbDate(today) } }] } } },
    include: { primaryDept: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const rows = (await Promise.all(emps.map(async (e) => ({ e, b: await runningBalance(prisma, e.id, today) }))))
    .filter((r): r is { e: (typeof emps)[number]; b: number } => r.b !== null)
    .sort((a, b) => a.b - b.b);
  const minus = rows.filter((r) => r.b < 0), plus = rows.filter((r) => r.b > 0);
  const sum = (x: typeof rows) => x.reduce((a, r) => a + r.b, 0);
  return (
    <div className="grid max-w-4xl gap-5">
      <div>
        <h1 className="text-3xl font-semibold">Plus / Minus</h1>
        <p className="mt-1 text-mute">Stand bis einschließlich gestern ({y.split("-").reverse().join(".")}). Abgeschlossene Monate plus laufender Monat anteilig. Nur für dich als Inhaber sichtbar.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-bad/50 bg-bad/10 p-5"><p className="text-sm tracking-wider text-mute">IM MINUS</p><p className="mt-1 text-3xl font-bold text-bad tabular">{signed(sum(minus))}</p><p className="text-sm text-mute">{minus.length} Mitarbeiter</p></div>
        <div className="rounded-2xl border border-good/50 bg-good/10 p-5"><p className="text-sm tracking-wider text-mute">ÜBERSTUNDEN</p><p className="mt-1 text-3xl font-bold text-good tabular">{signed(sum(plus))}</p><p className="text-sm text-mute">{plus.length} Mitarbeiter</p></div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-coal">
        <table className="w-full min-w-[520px] text-left text-sm tabular">
          <thead className="text-xs tracking-wider text-mute"><tr><th className="px-4 py-3">MITARBEITER</th><th>ABTEILUNG</th><th className="text-right">STAND</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ e, b }) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-4 py-3 font-semibold">{e.firstName} {e.lastName}</td>
                <td className="text-mute">{e.primaryDept.name}</td>
                <td className={`text-right text-lg font-bold ${b < 0 ? "text-bad" : b > 0 ? "text-good" : ""}`}>{signed(b)}</td>
                <td className="pr-4 text-right"><Link href={`/admin/stundenkonten/${e.id}`} className="rounded-lg border border-line px-3 py-2 hover:bg-slate">Details</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="px-4 py-6 text-mute">Keine Festangestellten mit Stundenkonto.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-mute">Hinweis: Das Soll wird gleichmäßig auf alle Kalendertage verteilt (wie beim Monatsabschluss). Nach freien Tagen kann der Stand deshalb kurzfristig im Minus sein und gleicht sich mit den nächsten Diensten wieder aus. Vergessenes Ausstempeln zählt erst nach der Korrektur.</p>
    </div>
  );
}
