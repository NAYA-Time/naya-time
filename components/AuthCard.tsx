export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line bg-coal p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/naya-logo.svg" alt="NAYA Restaurant & Bar" className="h-14 w-auto" />
        <p className="mt-2 text-xs tracking-[0.3em] text-gold">TIME</p>
        <h1 className="mb-6 mt-2 text-2xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
