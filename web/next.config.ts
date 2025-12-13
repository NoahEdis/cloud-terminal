import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
