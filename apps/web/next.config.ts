import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@open-evals/core", "@open-evals/adapters", "@open-evals/db"]
};

export default nextConfig;
