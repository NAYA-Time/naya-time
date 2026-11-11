import { ActionForm, Field } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { inviteFor } from "@/lib/portal";
import { acceptInviteAction } from "@/lib/portal-actions";

export const metadata = { title: "Mein NAYA – Zugang einrichten" };
export const dynamic = "force-dynamic";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await inviteFor(token);
  if (!c) return <AuthCard title="Link ungültig"><p className="text-mute">Der Link ist abgelaufen oder wurde schon benutzt. Bitte bei der Leitung einen neuen holen.</p></AuthCard>;
  return (
    <AuthCard title={`Hallo ${c.employee.firstName}`}>
      <p className="mb-2 text-mute">Lege ein Passwort für „Mein NAYA“ fest. Damit siehst du am Handy deinen Dienstplan und kannst Urlaub beantragen.</p>
      <p className="mb-5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3">Deine Personalnummer zum Anmelden: <span className="font-semibold text-gold tabular">{c.employee.personnelNumber}</span></p>
      <ActionForm action={acceptInviteAction} submit="Passwort speichern">
        <input type="hidden" name="token" value={token} />
        <Field label="Neues Passwort (mind. 10 Zeichen, nicht dein PIN)" name="password" type="password" autoComplete="new-password" required />
        <Field label="Passwort wiederholen" name="password2" type="password" autoComplete="new-password" required />
      </ActionForm>
    </AuthCard>
  );
}
