import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // 默认端口必须和本项目后端一致（8788）；8787 是别的本地应用，指错会静默串到别的服务上
    return [{ source: "/api/:path*", destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8788"}/api/:path*` }];
  },
};

export default nextConfig;
