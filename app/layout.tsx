import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NAYA TIME",
  description: "Smart Workforce Management – Restaurant NAYA Hamburg",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "NAYA TIME", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple-touch-icon.png", icon: "/icons/icon-192.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: "#141518",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
