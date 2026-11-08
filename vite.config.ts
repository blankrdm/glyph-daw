import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this project from /glyph-daw/. Local builds stay at /.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/glyph-daw/' : '/',
});
