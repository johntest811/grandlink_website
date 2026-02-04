/** @type {import('next').NextConfig} */
const nextConfig = {
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