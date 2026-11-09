import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminInvite, toggleAddSessionRight } from "@/lib/admin-actions-settings";
import { ADD_SESSION_PERMISSION } from "@/lib/corrections";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Administratoren – NAYA TIME" };

export default async function Administratoren() {
  await requireAdmin("admins.manage");
  const [users, roles] = await Promise.all([
    prisma.adminUser.findMany({ include: { role: { include: { permissions: true } } }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="grid max-w-4xl gap-5">
      <h1 className="text-3xl font-semibold">Administratoren</h1>
      <p className="text-mute">Wer sich im Backoffice anmelden darf. „Schichten nachtragen“ ist ein Sonderrecht: Inhaber haben es immer, andere nur, wenn es hier eingeschaltet ist.</p>
      <div className="grid gap-2">
        {users.map((u) => {
          const viaRole = u.role.permissions.some((p) => p.permissionKey === ADD_SESSION_PERMISSION);
          const extra = u.extraPermissions.includes(ADD_SESSION_PERMISSION);
          return (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-coal px-4 py-3">
              <div>
                <p className="font-semibold">{u.name}{!u.active && <span className="text-mute"> (deaktiviert)</span>}</p>
                <p className="text-sm text-mute">{u.email} · {u.role.name} · 2FA {u.totpEnabled ? "eingerichtet" : "fehlt"}{u.lastLoginAt ? ` · zuletzt ${u.lastLoginAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}` : ""}</p>
              </div>
              {viaRole ? (
                <span className="text-sm text-good">Darf Schichten nachtragen (Rolle)</span>
              ) : (
                <form action={toggleAddSessionRight}>
                  <input type="hidden" name="id" value={u.id} />
                  <button className={`min-h-11 rounded-xl border px-4 text-sm ${extra ? "border-good/60 text-good" : "border-line text-mute hover:bg-slate"}`}>
                    {extra ? "✓ Darf Schichten nachtragen – entziehen" : "Recht „Schichten nachtragen“ geben"}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <section className="grid gap-4 rounded-2xl border border-line bg-coal p-5">
        <h2 className="text-xl font-semibold">Neues Konto einrichten</h2>
        <p className="text-sm text-mute">Erzeugt einen persönlichen Link (einmalig, 24 Std. gültig). Die Person legt damit selbst Kennwort und Zwei-Faktor-Schutz an. Ein neuer Link macht den vorherigen ungültig.</p>
        <ActionForm action={createAdminInvite} submit="Einrichtungslink erzeugen">
          <label className="grid gap-1.5 text-sm text-mute">Rolle
            <select name="role" defaultValue="MANAGER" className="min-h-12 rounded-xl border border-line bg-ink px-4 text-paper">
              {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
