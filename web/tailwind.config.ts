import type { Config } from 'tailwindcss'
import tailwindAnimate from 'tailwindcss-animate'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark theme base
        base:    { DEFAULT: '#0A0A14', 50: '#141420', 100: '#1E1E30' },
        surface: { DEFAULT: '#141420', soft: '#0A0A14', raised: '#1E1E30' },
        border:  { DEFAULT: '#252540', soft: '#1A1A2E' },
        // Brand
        primary: { DEFAULT: '#00D632', hover: '#00B82B', light: '#33E055', dark: '#009E25' },
        accent:  { DEFAULT: '#7B2FF7', hover: '#6B21A8', light: '#A855F7' },
        success: { DEFAULT: '#10B981', hover: '#059669', light: '#34D399' },
        warning: { DEFAULT: '#F59E0B', hover: '#D97706', light: '#FCD34D' },
        danger:  { DEFAULT: '#EF4444', hover: '#DC2626', light: '#F87171' },
        // Text
        text: {
          primary:   '#F1F5F9',
          secondary: '#94A3B8',
          muted:     '#64748B',
          inverse:   '#0A0A14',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-dot': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [tailwindAnimate],
}
export default config
