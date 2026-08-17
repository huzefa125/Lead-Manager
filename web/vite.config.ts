import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'

// `import.meta.dirname` rather than `__dirname`: this config is ESM, and the
// native config loader Vite is moving to does not provide the CJS globals.
const rootDir = import.meta.dirname

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `.env` files are not on `process.env` while the config itself is being
  // evaluated — Vite only exposes them to client code. Reading the proxy
  // target straight off `process.env` therefore ignores `.env.local` and
  // silently falls back to the default port, which is a confusing failure:
  // requests reach whatever else is listening there. `loadEnv` is the
  // supported way to read them here.
  const env = loadEnv(mode, rootDir, 'VITE_')

  return {
    plugins: [
      // Must precede the React plugin — it generates routeTree.gen.ts from src/routes.
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: { '@': path.resolve(rootDir, './src') },
    },
    server: {
      port: 3000,
      // Same-origin in dev, so the httpOnly refresh cookie is sent without any
      // cross-site cookie configuration.
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  }
})
