import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { createPairingCode, toggleTerminal } from "@/lib/admin-actions-terminals";
import { ActionForm } from "@/components/ActionForm";
import { Section } from "@/components/Select";

export default async function Terminals() {
  await requireAdmin("terminal.manage");
  const devices = await prisma.terminalDevice.findMany({ orderBy: { pairedAt: "desc" } });
  const allowed = (process.env.TERMINAL_ALLOWED_IPS ?? "").split(",").filter(Boolean);
  return (
    <div className="grid max-w-3xl gap-5">
      <h1 className="text-3xl font-semibold">Terminals</h1>
      <Section title="Neues iPad koppeln" hint="Nur gekoppelte Geräte können stempeln. Der Code ist 15 Minuten gültig und nur einmal verwendbar.">
        <ActionForm action={createPairingCode} submit="Kopplungscode erzeugen"><span /></ActionForm>
      </Section>
      <Section title="Netzwerk" hint="Optional kann das Stempeln auf den Internetanschluss des Restaurants beschränkt werden.">
        <p>{allowed.length ? <>Stempeln nur erlaubt von: <b>{allowed.join(", ")}</b></> : "Zurzeit keine Netzwerk-Beschränkung (wird bei der Einrichtung des Servers festgelegt)."}</p>
      </Section>
      <Section title="Gekoppelte Geräte">
        {devices.length === 0 ? <p className="text-mute">Noch kein Gerät gekoppelt.</p> : (
          <ul className="grid gap-3">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
                <span><b>{d.name}</b> <span className={d.active ? "text-good" : "text-bad"}>{d.active ? "aktiv" : "gesperrt"}</span><br />
                  <span className="text-sm text-mute">Gekoppelt {d.pairedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} · zuletzt aktiv {d.lastSeenAt ? d.lastSeenAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "–"}</span></span>
                <ActionForm action={toggleTerminal} submit={d.active ? "Sperren" : "Freigeben"} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={d.id} /><input type="hidden" name="active" value={d.active ? "false" : "true"} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
