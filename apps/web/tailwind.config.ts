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
        // ── Forest Green scale ──────────────────────
        green: {
          50:  '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#065F46',
          800: '#064E3B',
          900: '#052E16',
          950: '#021C0E',
        },
        // ── Copper / Amber scale ────────────────────
        copper: {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#F59E0B',
          500: '#D97706',
          600: '#B45309',
          700: '#92400E',
          800: '#78350F',
          900: '#451A03',
        },
        // ── Night sky scale — dark mode base ────────
        night: {
          50:  '#E4E7F1',
          100: '#C7CCE0',
          200: '#9CA3C4',
          300: '#6B7299',
          400: '#454B75',
          500: '#2A2F57',
          600: '#1B1F40',
          700: '#12152F',
          800: '#0B0D20',
          900: '#060714',
          950: '#03040A',
        },
        // ── Semantic aliases ────────────────────────
        brand: {
          DEFAULT:  '#052E16',
          light:    '#064E3B',
          mid:      '#059669',
          soft:     '#D1FAE5',
          surface:  '#ECFDF5',
        },
        accent: {
          DEFAULT:  '#F59E0B',
          dark:     '#D97706',
          darker:   '#92400E',
          light:    '#FDE68A',
          surface:  '#FFFBEB',
        },
        // ── Neutral ──────────────────────────────────
        surface: {
          DEFAULT: '#F0FDF4',
          card:    '#FFFFFF',
          muted:   '#F8FAFC',
        },
        // ── Status ───────────────────────────────────
        success: { DEFAULT: '#059669', bg: '#D1FAE5', text: '#064E3B' },
        warning: { DEFAULT: '#D97706', bg: '#FEF3C7', text: '#92400E' },
        danger:  { DEFAULT: '#DC2626', bg: '#FEE2E2', text: '#991B1B' },
        info:    { DEFAULT: '#2563EB', bg: '#DBEAFE', text: '#1E40AF' },
      },
      backgroundImage: {
        // Card hero gradient — dark green sweep
        'hero-gradient':
          'linear-gradient(135deg, #052E16 0%, #064E3B 50%, #065F46 100%)',
        // Subtle surface tint
        'surface-gradient':
          'linear-gradient(180deg, #ECFDF5 0%, #F0FDF4 100%)',
        // Copper accent gradient for CTA buttons
        'copper-gradient':
          'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)',
        // Card back grid bg
        'card-back':
          'linear-gradient(160deg, #F0FDF4 0%, #ECFDF5 100%)',
        // Nav bar background
        'nav-gradient':
          'linear-gradient(180deg, #052E16 0%, #021C0E 100%)',
        // Night sky gradient — dark mode background, deep space feel
        'night-gradient':
          'linear-gradient(180deg, #03040A 0%, #0B0D20 45%, #12152F 100%)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        'card':    '0 2px 16px 0 rgba(5, 46, 22, 0.08)',
        'card-lg': '0 8px 32px 0 rgba(5, 46, 22, 0.12)',
        'copper':  '0 4px 16px 0 rgba(245, 158, 11, 0.25)',
        'nav':     '0 -4px 24px 0 rgba(5, 46, 22, 0.15)',
      },
      keyframes: {
        'liquid-blob': {
          '0%, 100%': { borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%' },
          '50%':      { borderRadius: '30% 60% 70% 40% / 50% 60% 30% 60%' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to:   { transform: 'translateY(0)' },
        },
        'card-flip': {
          from: { transform: 'rotateY(0deg)' },
          to:   { transform: 'rotateY(180deg)' },
        },
        'pulse-green': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(5, 150, 105, 0.4)' },
          '50%':      { boxShadow: '0 0 0 8px rgba(5, 150, 105, 0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'liquid-blob': 'liquid-blob 4s ease-in-out infinite',
        'fade-up':     'fade-up 0.3s ease-out',
        'fade-in':     'fade-in 0.2s ease-out',
        'slide-up':    'slide-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'pulse-green': 'pulse-green 2s ease-in-out infinite',
        shimmer:       'shimmer 1.5s ease-in-out infinite',
      },
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-top':    'env(safe-area-inset-top)',
      },
    },
  },
  plugins: [],
}

export default config
