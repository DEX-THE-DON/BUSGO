import type { Metadata } from "next";
import "./globals.css";
import "./auth.css";
import Providers from "./providers";
import PwaRegister from "@/components/pwa/PwaRegister";

const geistSans = { variable: "--font-geist-sans" };
const geistMono = { variable: "--font-geist-mono" };
const poppins = { variable: "--font-poppins" };

export const metadata: Metadata = {
  title: "BUSGO — Dynamic Kenyan Transit & Operations",
  description: "Dynamic corridor transit booking, matatu seating layouts, real-time highway telemetry, and offline driver manifest operations.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BUSGO",
  },
  icons: {
    icon: "/icons/icon-192.svg",
    apple: "/icons/icon-192.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
