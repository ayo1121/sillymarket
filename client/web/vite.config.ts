import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    // Backend CORS expects origin: http://localhost:8080
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'og-default.png', 'favicon.png'],
      manifest: {
        name: 'sillymarket - Prediction Markets',
        short_name: 'sillymarket',
        description: 'Prediction markets on Solana - the silliest outcome is always the most likely',
        start_url: '/',
        display: 'standalone',
        background_color: '#c0c0c0',
        theme_color: '#15a349',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        categories: ['finance', 'entertainment']
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache Supabase API calls (market data)
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5, // 5 minutes
              },
              networkTimeoutSeconds: 10,
            },
          },
          {
            // Cache images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // Enable in development for testing
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      crypto: "crypto-browserify",
      stream: "stream-browserify",
      vm: path.resolve(__dirname, "./src/polyfills/vm.ts"),
    },
  },
  // SECURITY: Strip console.log and debugger statements in production builds
  build: {
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },

    // Manual chunk splitting for better caching
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "INVALID_ANNOTATION" && warning.id?.includes("/node_modules/ox/")) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          // React vendor chunk
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],

          // Solana vendor chunk
          'solana-vendor': [
            '@solana/web3.js',
            '@solana/wallet-adapter-react',
            '@solana/wallet-adapter-base',
            '@solana/wallet-adapter-wallets',
          ],

          // UI vendor chunk
          'ui-vendor': [
            'lucide-react',
            '@radix-ui/react-dialog',
            '@radix-ui/react-select',
            '@radix-ui/react-tooltip',
          ],

          // Query vendor chunk
          'query-vendor': ['@tanstack/react-query'],
        },
      },
    },

    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@solana/web3.js',
      '@tanstack/react-query',
      'crypto-browserify',
      'stream-browserify',
    ],
  },
}));
