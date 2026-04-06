import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig({
  base: '/editor_falda/',  // ⚠️ IMPORTANTE: Cambia según el nombre de tu repo
  plugins: [react()],
});
