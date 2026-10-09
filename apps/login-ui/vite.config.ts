import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    // `pnpm dev` against the deployed API. CloudFront serves UI and API on one origin in prod.
    proxy: {
      '/api': { target: 'https://textauth.lionsportsusa.com', changeOrigin: true },
    },
  },
});
