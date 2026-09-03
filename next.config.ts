import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The floating Next badge sat over the workbench corner; errors still surface.
  devIndicators: false,
  serverExternalPackages: ['esbuild'],
  // Applets compile React source at request time. Next's tracer sees the
  // CommonJS entry files but cannot infer the production CJS files they
  // require dynamically, so Vercel must carry those files explicitly.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/react/**/*',
      './node_modules/react-dom/**/*',
      './node_modules/scheduler/**/*',
    ],
  },
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
