import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Same brand palette as apps/web — one visual identity across
        // every MonieKing surface, mobile or desktop.
        green: {
          50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7',
          400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#065F46',
          800: '#064E3B', 900: '#052E16', 950: '#021C0E',
        },
        copper: {
          50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D',
          400: '#F59E0B', 500: '#D97706', 600: '#B45309', 700: '#92400E',
          800: '#78350F', 900: '#451A03',
        },
        night: {
          50: '#E4E7F1', 100: '#C7CCE0', 200: '#9CA3C4', 300: '#6B7299',
          400: '#454B75', 500: '#2A2F57', 600: '#1B1F40', 700: '#12152F',
          800: '#0B0D20', 900: '#060714', 950: '#03040A',
        },
      },
      boxShadow: {
        card:    '0 2px 16px 0 rgba(5, 46, 22, 0.08)',
        'card-lg': '0 8px 32px 0 rgba(5, 46, 22, 0.12)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
