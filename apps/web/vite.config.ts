import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

function resolvePort(rawValue: string | undefined, fallback: number): number {
  const port = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiPort = resolvePort(env.API_PORT || process.env.API_PORT, 3000);
  const webPort = resolvePort(env.WEB_PORT || process.env.WEB_PORT, 5173);

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: webPort,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
