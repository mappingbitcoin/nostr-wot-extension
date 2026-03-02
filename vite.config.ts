import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { transform } from 'esbuild';
import manifest from './manifest.json' with { type: 'json' };

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Post-build plugin: compile badges/engine.ts → badges/engine.js.
 *
 * crxjs copies web_accessible_resources as-is (no TypeScript compilation).
 * The badge engine runs in MAIN world via scripting.executeScript, so it
 * must be valid JavaScript. This plugin strips types after crxjs finishes
 * and patches the dist manifest to reference the compiled .js file.
 */
function compileBadgeEngine(): Plugin {
  return {
    name: 'compile-badge-engine',
    apply: 'build',
    async closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      const tsFile = resolve(outDir, 'badges/engine.ts');
      const jsFile = resolve(outDir, 'badges/engine.js');

      if (!existsSync(tsFile)) return;

      const code = readFileSync(tsFile, 'utf-8');
      const result = await transform(code, {
        loader: 'ts',
        format: 'iife',
        target: 'es2022',
      });
      writeFileSync(jsFile, result.code);
      unlinkSync(tsFile);

      // Patch dist manifest to reference the compiled .js
      const mf = resolve(outDir, 'manifest.json');
      if (existsSync(mf)) {
        const txt = readFileSync(mf, 'utf-8');
        writeFileSync(mf, txt.replace(/badges\/engine\.ts/g, 'badges/engine.js'));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    compileBadgeEngine(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        prompt: resolve(__dirname, 'src/prompt/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@assets': resolve(__dirname, 'src/assets'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@components': resolve(__dirname, 'src/components'),
      '@lib': resolve(__dirname, 'lib'),
    },
  },
});
