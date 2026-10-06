// Vitest config scoped to the comfy-dashboard distribution.
// Uses jsdom environment for React component testing with global APIs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Same define as vite.config.ts: vitest.config.ts takes precedence over
// vite.config.ts under tests, so without this `__APP_VERSION__` would be
// undefined (literal ReferenceError) inside test sources. Path resolution
// uses process.cwd() for the same transform-compatibility reason noted in
// vite.config.ts — vitest always sets cwd to the project root.
const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        passWithNoTests: true,
    },
});
