import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminInvite, setAdminPermissions } from "@/lib/admin-actions-settings";
import { OWNER_ONLY_PERMISSIONS } from "@/lib/permissions";
import { ActionForm } from "@/components/ActionForm";

export const metadata = { title: "Administratoren – NAYA TIME" };

export default async function Administratoren() {
  const me = await requireAdmin("admins.manage");
  const isOwner = me.roleKey === "OWNER";
  const [users, roles, perms] = await Promise.all([
    prisma.adminUser.findMany({ include: { role: { include: { permissions: true } } }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
  ]);
  const grantable = perms.filter((p) => !OWNER_ONLY_PERMISSIONS.includes(p.key));
  return (
    <div className="grid max-w-4xl gap-5">
      <h1 className="text-3xl font-semibold">Administratoren</h1>
      <p className="text-mute">Wer sich im Backoffice anmelden darf. Der Inhaber hat immer alle Rechte. Für alle anderen legst du hier Recht für Recht fest, was sie sehen und tun dürfen.</p>
      <div className="grid gap-2">
        {users.map((u) => {
          const eff = new Set([...u.role.permissions.map((p) => p.permissionKey), ...u.extraPermissions].filter((k) => !u.revokedPermissions.includes(k)));
          return (
            <div key={u.id} className="rounded-xl border border-line bg-coal px-4 py-3">
              <p className="font-semibold">{u.name}{!u.active && <span className="text-mute"> (deaktiviert)</span>}</p>
              <p className="text-sm text-mute">{u.email} · {u.role.name} · 2FA {u.totpEnabled ? "eingerichtet" : "fehlt"}{u.lastLoginAt ? ` · zuletzt ${u.lastLoginAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}` : ""}</p>
              {u.role.key === "OWNER" ? (
                <p className="mt-1 text-sm text-good">Alle Rechte (Inhaber)</p>
              ) : (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-gold">Rechte ansehen{isOwner ? " und ändern" : ""} ({eff.size} von {grantable.length})</summary>
                  <ActionForm action={setAdminPermissions} submit="Rechte speichern" className="mt-3 grid gap-3">
                    <input type="hidden" name="id" value={u.id} />
                    <fieldset disabled={!isOwner} className="grid gap-1.5 sm:grid-cols-2">
                      {grantable.map((p) => (
                        <label key={p.key} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                          <input type="checkbox" name="perm" value={p.key} defaultChecked={eff.has(p.key)} className="mt-0.5 size-5 shrink-0 accent-gold" />
                          <span>{p.description}</span>
                        </label>
                      ))}
                    </fieldset>
                    {!isOwner && <p className="text-sm text-mute">Ändern kann nur der Inhaber.</p>}
                  </ActionForm>
                </details>
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
