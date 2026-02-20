import type { NextConfig } from 'next';
import path from 'path';

const appBaseUrl = process.env['APP_BASE_URL'] ?? '';
const apiBaseUrl = process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? '';

if (process.env['NODE_ENV'] === 'production') {
  if (!appBaseUrl) {
    console.error('Missing APP_BASE_URL in web service environment');
  }
  if (!apiBaseUrl) {
    console.error('Missing API_BASE_URL in web service environment');
  }
}

const nextConfig: NextConfig = {
  transpilePackages: ['@live-sales-coach/shared'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
  output: 'standalone',
  distDir: process.env['NODE_ENV'] === 'development' ? '.next-dev' : '.next',
  env: {
    NEXT_PUBLIC_API_URL: apiBaseUrl || (process.env['NODE_ENV'] === 'production' ? '' : 'http://localhost:3001'),
    NEXT_PUBLIC_APP_BASE_URL: appBaseUrl,
  },
};

export default nextConfig;
