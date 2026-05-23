/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone output bundles only required node_modules into .next/standalone,
  // shrinking the Docker runtime image and removing the need to ship pnpm/workspaces.
  output: 'standalone',
  // Trace from the monorepo root so workspace deps (@vantage/shared, etc.) are
  // included in the standalone bundle.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  experimental: {
    typedRoutes: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
