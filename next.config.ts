import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The floating Next badge sat over the workbench corner; errors still surface.
  devIndicators: false,
  serverExternalPackages: ['esbuild'],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    taint: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ]
  },
}

export default nextConfig
