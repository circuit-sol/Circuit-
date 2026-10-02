import type { NextConfig } from "next";

import path from 'node:path';

let backendHostname = 'localhost';
let backendProtocol = 'http';
let backendPort = '3001';
try {
  const backendUrl = new URL(process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001');
  backendHostname = backendUrl.hostname;
  backendProtocol = backendUrl.protocol.replace(':', '');
  backendPort = backendUrl.port || '';
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
        protocol: (backendProtocol as 'http' | 'https') || 'http',
        hostname: backendHostname,
        ...(backendPort ? { port: backendPort } : {}),
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.railway.app',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
