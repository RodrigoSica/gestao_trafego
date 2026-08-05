import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  images: {
    unoptimized: process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production" ? false : true,
  },
  experimental: {
    esmExternals: true,
  },
};

export default nextConfig;
