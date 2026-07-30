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
        surface: { DEFAULT: '#141420', soft: '#0A0A14', raised: '#1E1E30', overlay: '#1A1A2A' },
        border:  { DEFAULT: '#252540', soft: '#1A1A2E', strong: '#303050' },
        // Brand
        primary: { DEFAULT: '#00D632', hover: '#00B82B', light: '#33E055', dark: '#009E25' },
        accent:  { DEFAULT: '#7B2FF7', hover: '#6B21A8', light: '#A855F7' },
        success: { DEFAULT: '#10B981', hover: '#059669', light: '#34D399' },
        warning: { DEFAULT: '#F59E0B', hover: '#D97706', light: '#FCD34D' },
        danger:  { DEFAULT: '#EF4444', hover: '#DC2626', light: '#F87171' },
        info:    { DEFAULT: '#38BDF8', hover: '#0EA5E9', light: '#7DD3FC' },
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
      /** Anchos fijos del chrome de la app — el shell y el sidebar leen de aca. */
      spacing: {
        sidebar: '17rem',
        'sidebar-collapsed': '4.5rem',
        topbar: '3.75rem',
      },
      boxShadow: {
        // Elevaciones — sombras profundas porque el fondo es casi negro.
        'elev-1': '0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
        'elev-2': '0 4px 12px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3)',
        'elev-3': '0 12px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)',
        'elev-4': '0 24px 64px rgba(0,0,0,0.65), 0 8px 24px rgba(0,0,0,0.4)',
        // Glows de marca — para estados activos y foco.
        'glow-primary': '0 0 0 1px rgba(0,214,50,0.35), 0 4px 24px -4px rgba(0,214,50,0.4)',
        'glow-accent':  '0 0 0 1px rgba(123,47,247,0.35), 0 4px 24px -4px rgba(123,47,247,0.4)',
        'glow-danger':  '0 0 0 1px rgba(239,68,68,0.35), 0 4px 24px -4px rgba(239,68,68,0.4)',
        'inner-top':    'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgba(37,37,64,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(37,37,64,0.35) 1px, transparent 1px)',
        sheen: 'linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.07) 50%, transparent 80%)',
      },
      animation: {
        'pulse-dot': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        // Nuevas — soporte para skeletons, glows y fondos vivos.
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'glow-pulse': 'glowPulse 2.4s ease-in-out infinite',
        aurora: 'aurora 18s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'spin-slow': 'spin 2.4s linear infinite',
        'ring-expand': 'ringExpand 1.8s cubic-bezier(0.16,1,0.3,1) infinite',
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
        shimmer: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.45' },
          '50%':      { opacity: '1' },
        },
        aurora: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%':      { transform: 'translate3d(4%,-3%,0) scale(1.08)' },
          '66%':      { transform: 'translate3d(-3%,3%,0) scale(0.96)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        ringExpand: {
          '0%':   { transform: 'scale(0.85)', opacity: '0.7' },
          '100%': { transform: 'scale(2.1)',  opacity: '0' },
        },
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [tailwindAnimate],
}
export default config
