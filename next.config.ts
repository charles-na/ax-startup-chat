import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/chat": ["./data/programs.json", "./data/manifest.json"] },
};

export default config;
