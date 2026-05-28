import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    // Fork-isolate each test file: src/db/index.ts holds a module-level
    // `dbPromise` singleton, and the better-sqlite3 in-memory DB it
    // returns is shared across files inside one thread-pool worker —
    // which caused beforeAll() timeouts when multiple DB-touching test
    // files ran in the same run (write-chain state leaked between files).
    // Forks give each test file its own Node process and clean module
    // graph.
    pool: 'forks',
  },
});
