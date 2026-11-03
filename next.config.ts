import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // self-hosted mode: NEXT_PUBLIC_SUPABASE_URL=/supabase, see src/lib/supabase/config.ts
  async rewrites() {
    const target = process.env.SUPABASE_INTERNAL_URL;
    return target ? [{ source: "/supabase/:path*", destination: `${target}/:path*` }] : [];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // model weights never change for a given package version
        source: "/models/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
