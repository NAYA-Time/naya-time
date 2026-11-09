import { ActionForm, Field } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { setupAdmin } from "@/lib/admin-actions-auth";

export const metadata = { title: "Ersteinrichtung – NAYA TIME" };
export default async function Setup({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Administrator-Konto anlegen">
      {!token ? <p className="text-bad">Dieser Link ist unvollständig. Bitte den vollständigen Einrichtungslink verwenden.</p> : (
        <ActionForm action={setupAdmin} submit="Konto anlegen">
          <input type="hidden" name="token" value={token} />
          <Field label="Name" name="name" autoComplete="name" required />
          <Field label="E-Mail" name="email" type="email" autoComplete="username" required />
          <Field label="Kennwort (mind. 12 Zeichen, Buchstaben und Ziffern)" name="password" type="password" autoComplete="new-password" required />
          <Field label="Kennwort wiederholen" name="password2" type="password" autoComplete="new-password" required />
        </ActionForm>
      )}
    </AuthCard>
  );
}
