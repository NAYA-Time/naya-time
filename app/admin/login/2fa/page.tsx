import { ActionForm, Field } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { verify2fa } from "@/lib/admin-actions-auth";

export const metadata = { title: "Bestätigungscode – NAYA TIME" };
export default function TwoFactor() {
  return (
    <AuthCard title="Bestätigungscode">
      <p className="mb-4 text-mute">Öffne deine Authenticator-App und gib den 6-stelligen Code für NAYA TIME ein. Handy nicht zur Hand? Dann einen deiner Wiederherstellungscodes (z. B. ABCD-EFGH) eingeben.</p>
      <ActionForm action={verify2fa} submit="Anmelden">
        <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </ActionForm>
    </AuthCard>
  );
}
