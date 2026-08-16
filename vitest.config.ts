import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    // Component tests opt into jsdom per-file via the
    // `// @vitest-environment jsdom` pragma in their file header.
  },
})
