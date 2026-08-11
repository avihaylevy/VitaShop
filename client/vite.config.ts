import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: {
      // 🔴 MILESTONE-004 / ISSUE-040. `src/lib/productImages.ts` globs the
      // repo-root `assets/products/` directory — the SAME directory the seed
      // reads — instead of a byte-identical copy inside the client. Without
      // this, the dev server refuses to serve files above its root.
      //
      // The alternative was keeping a duplicate copy per product, which would
      // have preserved the manual per-product step the glob exists to remove
      // and let the two copies drift. One source of truth is worth the
      // coupling; the client and the seed were already coupled by filename,
      // just with nothing enforcing it.
      allow: ['..'],
    },
  },
})
