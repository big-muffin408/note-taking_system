import type { ServerOptions } from 'vite';

export const manualChunks: Record<string, string[]> = {
  'vendor-react': ['react', 'react-dom', 'react-router-dom'],
  'vendor-tiptap': [
    '@tiptap/react',
    '@tiptap/starter-kit',
    '@tiptap/extension-placeholder',
    '@tiptap/extension-collaboration',
    '@tiptap/extension-collaboration-cursor',
  ],
  'vendor-yjs': ['yjs', 'y-websocket'],
};

export const proxy: ServerOptions['proxy'] = {
  '/api/user': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/user/, ''),
  },
  '/api/doc': {
    target: 'http://localhost:3002',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/doc/, ''),
  },
  '/api/ai': {
    target: 'http://localhost:3003',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/ai/, ''),
  },
  '/api/sync': {
    target: 'http://localhost:3005',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/sync/, ''),
  },
  '/ws': {
    target: 'ws://localhost:3004',
    ws: true,
  },
};
