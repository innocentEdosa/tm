import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Design system lock (2026-07-05, Desktop Shell Visual Language spec) — Inter for body/UI text,
// Plus Jakarta Sans for headings/display, JetBrains Mono for monospace — per constitution Principle
// V: this becomes the binding standard for all screens going forward.
// Named `-loaded` to avoid colliding with the Tailwind `@theme` tokens of the almost-same name
// (`--font-sans`/`--font-heading`/`--font-mono`, globals.css) — those tokens read `var(--font-*-
// loaded)` to build the actual font stack. Giving both the same name creates a self-referencing
// custom property (invalid at compute time), which silently falls back to the browser default sans
// with no error — confirmed via computed-style inspection in a running browser.
const inter = Inter({
  variable: "--font-sans-loaded",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-heading-loaded",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-mono-loaded",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "TM",
  description: "TM Application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plusJakartaSans.variable} ${jetBrainsMono.variable}`}
    >
      {/* Font variables live on <html>, not <body> — the `@theme` tokens that consume them
         (--font-sans etc., globals.css) are declared on `:root`, which can only see custom
         properties set on `:root` itself or an ancestor, never on a descendant like <body>. */}
      <body className="antialiased">{children}</body>
    </html>
  );
}
