import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // `__APP_VERSION__` define was removed when the Shell switched to a
  // runtime `import pkg from '../../../package.json'`. If something
  // re-needs a compile-time constant, restore here with the ESM-safe
  // `JSON.parse(readFileSync(...))` pattern, not require().
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 5180,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5181,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    // Source maps (~5 MB) ship inside the Tauri binary and slow the first
    // parse on iOS WKWebView. They're useless to end users, so emit them only
    // for the `vite` dev server (which inlines its own regardless of this).
    sourcemap: false,
    rollupOptions: {
      external: ['better-sqlite3'],
      output: {
        // Split heavy, lazily-used libraries out of the entry chunk so first
        // paint doesn't download/parse them. TipTap+ProseMirror (the rich-text
        // editor) is only needed once a task detail is opened; dnd-kit and the
        // date/NLP libs get their own cacheable chunks too.
        //
        // Function (not object) form: matching by module-id substring avoids
        // Rollup trying to resolve bare package entries like `@tiptap/pm`,
        // which has no "." export (it only ships subpaths like
        // `@tiptap/pm/state`) and fails entry resolution in the object form.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor';
          if (id.includes('@dnd-kit')) return 'dnd';
          if (id.includes('chrono-node') || id.includes('date-fns')) return 'datetime';
          return undefined;
        },
      },
    },
  },
});
