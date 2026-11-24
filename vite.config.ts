import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins:[react(),tailwind()],
    envPrefix:[],
    define:{
      'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    },
    build:{chunkSizeWarningLimit:1100},
    server:{proxy:{'/api':'http://127.0.0.1:'+(env.PORT || 3000)}},
  }
})
