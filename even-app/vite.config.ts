import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'serve-app-json',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/app.json') {
            res.setHeader('Content-Type', 'application/json');
          }
          next();
        });
      },
    },
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx',
          dest: './',
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
          dest: './',
        },
        {
          src: 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js',
          dest: './',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: './',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.mjs',
          dest: './',
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@toolkit': path.resolve(__dirname, '..'),
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    host: true,
    port: 5173,
    cors: {
      origin: '*', // Allow all origins for local dev, including glasses .ehpk
      methods: 'GET,POST,PUT,DELETE,OPTIONS',
      allowedHeaders: 'Content-Type, Authorization',
    },
  },
});
