import type { NextConfig } from "next";

import path from 'node:path';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  images: {
    formats: ['image/webp'],
  },
};

export default nextConfig;
