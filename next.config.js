/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  env: {
    NEXT_PUBLIC_LUGAR: process.env.NEXT_PUBLIC_LUGAR || 'HIGA',
  },
}

module.exports = nextConfig
