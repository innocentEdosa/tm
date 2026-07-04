import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Design system lock (2026-07-04, Tenant Authentication Configuration spec) — Plus Jakarta Sans,
// per constitution Principle V: this becomes the binding standard for all screens going forward.
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TM",
  description: "TM Application",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${plusJakartaSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
