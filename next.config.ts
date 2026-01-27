import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  // Windows can sometimes throw EPERM on `.next/trace` when file tracing
  // collides with locked files or multiple lockfiles.
  outputFileTracing: false,
  outputFileTracingRoot: __dirname,
  images: {
    domains: [
      "gijnybivawnsilzqegik.supabase.co",
      "lh3.googleusercontent.com",
      "placehold.co",
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
