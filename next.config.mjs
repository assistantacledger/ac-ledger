/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: async () => 'build',

  webpack: (config, { isServer, dev }) => {
    // Disable webpack cache in production to avoid Cloudflare Pages size limits
    if (!dev) {
      config.cache = false
    }
    // Disable build worker to reduce memory usage during CI builds
    config.infrastructureLogging = { level: 'error' }
    return config
  },
}

export default nextConfig
