// Vite config for the comfy-dashboard distribution.
// `base` is set to "./" so all asset paths are relative — works on any GitHub Pages subpath.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read the package version at config time (raw fs read instead of a JSON
// import so tsconfig does not need resolveJsonModule for the config file).
// It is injected into the app bundle via `define` below so the header's
// app-name fallback title ("Comfy Dashboard v<version>") can display it
// without bundling the whole package.json into the client. Same pattern as
// distribution/story-generator.
//
// Path resolution: process.cwd() (NOT new URL(..., import.meta.url)) — vitest
// loads config modules through its own transform, where import.meta.url can
// be a virtual module id (not a file URL) and `new URL` throws "The URL must
// be of scheme file". Vitest always sets cwd to the project root (the
// directory containing vitest.config.ts), so a cwd-relative read works
// identically for `vite build`, `vite dev`, and `vitest run`.
const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
    plugins: [react()],
    // Relative base path so the build works on GitHub Pages subpaths
    base: './',
    define: {
        // Compile-time constant — replaced with the literal version string
        // (e.g. "1.0.2") in both dev and build output. Mirrored in
        // vitest.config.ts (which takes precedence under tests) and declared
        // ambient in src/vite-env.d.ts for `tsc --noEmit`.
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    // Keep the development server on the requested dashboard port without affecting preview or production builds.
    server: {
        port: 8100,
        // Never watch the service's shared writable data root: chokidar
        // holding files under temporary/database while the underload service
        // writes them surfaces as sporadic EPERM failures on Windows.
        watch: {
            ignored: ['**/temporary/**']
        }
    },
    build: {
        outDir: 'dist',
    },
});
