import type {NextConfig} from 'next';
import { legacyToolRedirects } from './lib/tools';

const nextConfig: NextConfig = {
  // Cho phép chạy nhiều server dev/build song song (mỗi tiến trình một thư mục build riêng)
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  // Tool đã chuyển từ /<id> sang /<nhóm>/<id>: giữ link, bookmark và lịch sử cũ hoạt động (308, giữ nguyên query)
  async redirects() {
    return legacyToolRedirects().map((r) => ({ ...r, permanent: true }));
  },
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
