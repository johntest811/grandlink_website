/** @type {import('next').NextConfig} */
const nextConfig = {
  // Windows can sometimes throw EPERM on `.next/trace` when file tracing
  // collides with locked files or multiple lockfiles.
  outputFileTracingRoot: __dirname,
  images: {
    domains: [
      "gijnybivawnsilzqegik.supabase.co",
      "lh3.googleusercontent.com",
      "placehold.co"
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;