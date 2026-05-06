import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-tiptap': [
            '@tiptap/react', '@tiptap/starter-kit',
            '@tiptap/extension-placeholder', '@tiptap/extension-collaboration',
            '@tiptap/extension-collaboration-cursor',
          ],
          'vendor-yjs': ['yjs', 'y-websocket'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      injectRegister: 'auto',
      manifest: {
        name: 'AI 协作笔记系统',
        short_name: 'AI Notes',
        description: 'AI 增强的协作式文档笔记系统',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        display: 'standalone',
        lang: 'zh-CN',
        icons: [
          { src: '/pwa-192x192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/pwa-512x512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/api\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/user': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/user/, '')
      },
      '/api/doc': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/doc/, '')
      },
      '/api/ai': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ai/, '')
      },
      '/api/sync': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sync/, '')
      },
      '/ws': {
        target: 'ws://localhost:3004',
        ws: true
      }
    }
  }
});
