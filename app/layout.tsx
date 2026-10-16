import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tetherbound",
  description: "How far from safety will you go for power?",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
