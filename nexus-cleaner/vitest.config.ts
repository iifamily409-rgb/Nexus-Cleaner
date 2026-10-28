import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * One config, two projects:
 *  - `node`  : unit + integration tests (real filesystem, sandboxed temp dirs)
 *  - `ui`    : jsdom + React Testing Library tests
 *
 * `npm test` runs both; `npm run test:node` / `npm run test:ui` run one.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    projects: [
      {
        plugins: [],
        resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          pool: 'threads'
        }
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared'),
            '@': resolve(__dirname, 'src/renderer/src')
          }
        },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
          setupFiles: ['tests/ui/setup.ts'],
          testTimeout: 30_000
        }
      }
    ]
  }
})
