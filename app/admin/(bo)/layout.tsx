import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { logoutAction } from "@/lib/admin-actions-auth";
import { setDeptFilter } from "@/lib/admin-actions-common";
import { currentDeptFilter } from "@/lib/dept";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backoffice – NAYA TIME" };

// Navigation laut Konzept. Noch nicht gebaute Bereiche sind sichtbar als „folgt“ markiert.
const NAV: { href?: string; label: string; perm?: string; soon?: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/mitarbeiter", label: "Mitarbeiter", perm: "employees.view" },
  { href: "/admin/dienstplan", label: "Dienstplan", perm: "employees.view" },
  { href: "/admin/zeiten", label: "Zeitbuchungen", perm: "timeclock.view" },
  { href: "/admin/krankheit", label: "Krankheit", perm: "employees.view" },
  { href: "/admin/urlaub", label: "Urlaub", perm: "employees.view" },
  { href: "/admin/stundenkonten", label: "Stundenkonten", perm: "employees.view" },
  { href: "/admin/monatsabschluss", label: "Monatsabschluss", perm: "employees.view" },
  { href: "/admin/aushilfen", label: "Aushilfenabrechnung", perm: "wages.view" },
  { href: "/admin/berichte", label: "Berichte", perm: "reports.create" },
  { href: "/admin/email", label: "E-Mail-Automatisierung", perm: "reports.email" },
  { href: "/admin/terminals", label: "Terminals", perm: "terminal.manage" },
  { href: "/admin/protokoll", label: "Änderungsprotokoll", perm: "settings.manage" },
  { href: "/admin/administratoren", label: "Administratoren", perm: "admins.manage" },
  { href: "/admin/einstellungen", label: "Einstellungen", perm: "settings.manage" },
];

export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const noRecovery = (await prisma.adminUser.findUnique({ where: { id: admin.id }, select: { recoveryCodes: true } }))?.recoveryCodes.length === 0;
  const dept = await currentDeptFilter();
  return (
    <div className="min-h-dvh select-text lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-coal px-4 py-4 lg:min-h-dvh lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/naya-logo.svg" alt="NAYA Restaurant & Bar" className="h-12 w-auto" />
        <p className="mb-5 mt-2 text-xs tracking-[0.2em] text-mute">TIME · BACKOFFICE</p>
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {NAV.filter((n) => !n.perm || admin.permissions.has(n.perm)).map((n) =>
            n.href ? (
              <Link key={n.label} href={n.href} className="whitespace-nowrap rounded-lg px-3 py-2.5 text-paper hover:bg-slate">{n.label}</Link>
            ) : (
              <span key={n.label} className="flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-mute/60">
                {n.label}<span className="text-[10px] tracking-wider">FOLGT</span>
              </span>
            ),
          )}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 lg:px-8">
          <form action={setDeptFilter} className="flex gap-1 rounded-xl border border-line p-1">
            {(["ALL", "KUECHE", "SERVICE"] as const).map((d) => (
              <button key={d} name="dept" value={d} className={`min-h-10 rounded-lg px-4 text-sm font-semibold tracking-wider ${dept === d ? "bg-gold text-ink" : "text-mute hover:text-paper"}`}>
                {d === "ALL" ? "ALLE" : d === "KUECHE" ? "KÜCHE" : "SERVICE"}
              </button>
            ))}
          </form>
          <div className="flex items-center gap-3 text-sm text-mute">
            <a href="/admin/konto" className="hover:text-paper">{admin.name} · {admin.roleName}</a>
            <form action={logoutAction}><button className="rounded-lg border border-line px-3 py-2 hover:text-paper">Abmelden</button></form>
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8">
          {noRecovery && <a href="/admin/konto" className="mb-5 block rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">Noch keine Wiederherstellungscodes für die Zwei-Faktor-Anmeldung – jetzt erzeugen →</a>}
          {children}
        </main>
      </div>
    </div>
  );
}
