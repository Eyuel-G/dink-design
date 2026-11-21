import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mysql2", "cheerio", "@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions", "draco3dgltf"],
  turbopack: {
    resolveAlias: {
      "./identity.dev.js": "./cursor/identity.dev.ts",
    },
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
