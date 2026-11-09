import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { RecoveryCodes } from "./RecoveryCodes";

export const metadata = { title: "Mein Konto – NAYA TIME" };

export default async function Konto({ searchParams }: { searchParams: Promise<{ neu?: string; "code-verwendet"?: string }> }) {
  const a = await requireAdmin();
  const sp = await searchParams;
  const row = await prisma.adminUser.findUniqueOrThrow({ where: { id: a.id }, select: { recoveryCodes: true, email: true, lastLoginAt: true } });
  const left = row.recoveryCodes.length;
  return (
    <div className="grid max-w-3xl gap-5">
      <h1 className="text-3xl font-semibold">Mein Konto</h1>
      <p className="text-mute">{a.name} · {row.email} · {a.roleName}</p>
      {sp.neu && <p className="rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-good">Zwei-Faktor-Schutz ist eingerichtet. Bitte jetzt noch Wiederherstellungscodes erzeugen – für den Fall, dass das Handy verloren geht.</p>}
      {sp["code-verwendet"] && <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">Du hast dich mit einem Wiederherstellungscode angemeldet. Noch {left} Code{left === 1 ? "" : "s"} übrig. Falls das Handy weg ist: Authenticator neu einrichten lassen und neue Codes erzeugen.</p>}
      <section className="grid gap-4 rounded-2xl border border-line bg-coal p-5">
        <h2 className="text-xl font-semibold">Wiederherstellungscodes</h2>
        <p className="text-mute">
          {left ? `Noch ${left} von 10 Codes gültig.` : "Noch keine Codes erzeugt."} Jeder Code funktioniert einmal anstelle des 6-stelligen App-Codes.
          Neue Codes machen alle bisherigen ungültig.
        </p>
        <RecoveryCodes />
      </section>
    </div>
  );
}
