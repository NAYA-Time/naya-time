import { ActionForm, Field } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { login } from "@/lib/admin-actions-auth";

export const metadata = { title: "Anmelden – NAYA TIME" };
export default function Login() {
  return (
    <AuthCard title="Backoffice-Anmeldung">
      <ActionForm action={login} submit="Weiter">
        <Field label="E-Mail" name="email" type="email" autoComplete="username" required />
        <Field label="Kennwort" name="password" type="password" autoComplete="current-password" required />
      </ActionForm>
    </AuthCard>
  );
}
