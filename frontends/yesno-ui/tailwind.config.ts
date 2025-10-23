import type { Config } from 'tailwindcss'

const config: Config = {
  // Tell Tailwind where to look for class names
  content: [
    './src/**/*.{ts,tsx,js,jsx}',
    './src/app/**/*.{ts,tsx,js,jsx}',
    './src/components/**/*.{ts,tsx,js,jsx}',
  ],

  // Optional, but nice to keep explicit
  darkMode: 'class',

  theme: {
    extend: {
      /* Font stacks */
      fontFamily: {
        brand: ['var(--font-brand)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      /* Design tokens (wired to CSS variables from globals.css) */
      colors: {
        surface: 'rgb(var(--surface) / <alpha-value>)',
        stroke:  'rgb(var(--stroke) / <alpha-value>)',
        text:    'rgb(var(--text) / <alpha-value>)',
        muted:   'rgb(var(--muted) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          600:     'rgb(var(--brand-600) / <alpha-value>)',
          700:     'rgb(var(--brand-700) / <alpha-value>)',
        },
      },

      /* Shared shadows/radii for cards & panels */
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,.06) inset, 0 8px 28px rgba(0,0,0,.35)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
    },
  },

  plugins: [],
}

export default config
