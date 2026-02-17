import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  transpilePackages: ['@live-sales-coach/shared'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
