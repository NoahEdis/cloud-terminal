import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Set turbopack root to this directory to fix module resolution
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Allow connecting to the terminal API from any origin
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
  // Redirect old routes to new ones
  async redirects() {
    return [
      {
        source: "/credentials",
        destination: "/integrations",
        permanent: true,
      },
      {
        source: "/credentials/add",
        destination: "/integrations/add",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
