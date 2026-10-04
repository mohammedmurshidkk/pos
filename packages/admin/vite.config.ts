import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import brand from '../../brand/brand.json'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'brand',
      transformIndexHtml: (html) => html
        .replaceAll('%BRAND_PRODUCT_NAME%', brand.productName)
        .replaceAll('%BRAND_PRIMARY%', brand.colors.primary),
    },
  ],
  server: {
    port: 3000,
    // The hub is the only backend; Electron will serve the built files from it.
    proxy: { '/api': 'http://localhost:4000', '/ws': { target: 'ws://localhost:4000', ws: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
})
