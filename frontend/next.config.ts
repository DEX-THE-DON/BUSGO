import type { NextConfig } from "next";

const LAN_HOSTS = [
  "localhost",
  "127.0.0.1",
  // The dev server advertises itself on the LAN (e.g. http://192.168.100.19:3000)
  // so it can be opened from a phone or another computer on the same network.
  "192.168.100.19",
];

const nextConfig: NextConfig = {
  // Next.js dev blocks cross-origin requests to dev resources by default.
  // Without this, opening the app from the LAN address loads a broken page
  // (blank UI, login does nothing). Add extra hosts via NEXT_PUBLIC_ALLOWED_ORIGINS.
  allowedDevOrigins: [
    ...LAN_HOSTS,
    ...(process.env.NEXT_PUBLIC_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
};

export default nextConfig;
