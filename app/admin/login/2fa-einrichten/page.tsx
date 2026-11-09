import { ActionForm, Field } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { confirmTotp, totpEnrollmentData } from "@/lib/admin-actions-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zwei-Faktor einrichten – NAYA TIME" };

export default async function Enroll() {
  const { qr, secret } = await totpEnrollmentData();
  return (
    <AuthCard title="Zwei-Faktor-Schutz einrichten">
      <ol className="mb-5 grid list-decimal gap-2 pl-5 text-mute">
        <li>Installiere eine Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator oder die iPhone-Passwörter-App).</li>
        <li>Scanne den QR-Code oder gib den Schlüssel von Hand ein.</li>
        <li>Gib den angezeigten 6-stelligen Code ein.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR-Code für die Authenticator-App" width={240} height={240} className="mx-auto mb-3 rounded-xl bg-white p-2" />
      <p className="mb-5 select-text text-center font-mono text-sm tracking-wider text-mute">{secret}</p>
      <ActionForm action={confirmTotp} submit="Bestätigen">
        <Field label="Code aus der App" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </ActionForm>
    </AuthCard>
  );
}
