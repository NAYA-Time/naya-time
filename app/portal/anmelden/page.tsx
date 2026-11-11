import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { currentPortalEmployee, portalLoginAction } from "@/lib/portal-actions";

export const metadata = { title: "Mein NAYA – Anmelden" };
export const dynamic = "force-dynamic";

export default async function PortalLogin() {
  if (await currentPortalEmployee()) redirect("/portal");
  return (
    <AuthCard title="Mein NAYA">
      <p className="mb-5 text-mute">Dein Dienstplan, deine Stunden und Urlaub. Stempeln geht nur am iPad im Restaurant.</p>
      <ActionForm action={portalLoginAction} submit="Anmelden">
        <Field label="Personalnummer" name="nr" autoComplete="username" inputMode="numeric" required />
        <Field label="Passwort" name="password" type="password" autoComplete="current-password" required />
      </ActionForm>
      <p className="mt-5 text-sm text-mute">Noch kein Zugang oder Passwort vergessen? Die Leitung gibt dir einen neuen Einladungslink.</p>
    </AuthCard>
  );
}
