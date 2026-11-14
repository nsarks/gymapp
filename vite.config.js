import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Relative base so the same build works on GitHub Pages (/gymapp/) or any other static host.
export default defineConfig({ base: './', plugins: [preact()], build: { target: 'es2020' } });
