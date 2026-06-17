import type { NextConfig } from "next";

import path from 'node:path';

// Parse the backend URL to dynamically whitelist its hostname
let backendHostname = 'localhost';
let backendProtocol = 'http';
try {
  const backendUrl = new URL(process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001');
  backendHostname = backendUrl.hostname;
  backendProtocol = backendUrl.protocol.replace(':', '');
} catch (e) {
  console.warn('Invalid NEXT_PUBLIC_BACKEND_URL');
}

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
  images: {
    formats: ['image/webp'],
    remotePatterns: [
      {
        protocol: backendProtocol as 'http' | 'https',
        hostname: backendHostname,
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
