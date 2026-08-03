// Vite config for the comfy-dashboard distribution.
// `base` is set to "./" so all asset paths are relative — works on any GitHub Pages subpath.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Relative base path so the build works on GitHub Pages subpaths
    base: './',
    // Keep the development server on the requested dashboard port without affecting preview or production builds.
    server: {
        port: 8100,
    },
    build: {
        outDir: 'dist',
    },
});
