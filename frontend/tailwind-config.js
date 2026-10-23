/**
 * CropSathi — Bolt Tailwind Design System Configuration
 * Loaded before/with tailwind CDN to provide all custom color scales,
 * typography, spacing, shadows, and animations.
 */
if (typeof tailwind !== 'undefined') {
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          forest: {
            50: '#EDF5F1',
            100: '#D2E6DC',
            200: '#A6CDB8',
            300: '#6FAA8C',
            400: '#356B49',
            500: '#1B4332',
            600: '#163A2B',
            700: '#112E22',
            800: '#0D2219',
            900: '#0A1A13',
          },
          offwhite: {
            50: '#FFFFFF',
            100: '#FAF9F6',
            200: '#F4F2EC',
            300: '#E9E5DA',
            400: '#D5D0C3',
          },
          terracotta: {
            50: '#FBEEE9',
            100: '#F5D6CB',
            200: '#E9AD9A',
            300: '#DC8469',
            400: '#C1502E',
            500: '#A8411F',
            600: '#87331A',
            700: '#692713',
            800: '#4D1B0E',
            900: '#34120A',
          },
          lavender: {
            50: '#F6F2F5',
            100: '#EAE1E7',
            200: '#D4C3CF',
            300: '#BBA5B5',
            400: '#9B8AA0',
            500: '#7E6B83',
            600: '#655269',
            700: '#4D3E50',
            800: '#362B38',
            900: '#241C26',
          },
          risk: {
            green: '#3F8259',
            yellow: '#D4A93A',
            orange: '#C1502E',
            red: '#A82828',
          },
        },
        fontFamily: {
          heading: ['"Be Vietnam Pro"', 'sans-serif'],
          body: ['"Noto Sans"', 'sans-serif'],
          serif: ['Lora', 'serif'],
        },
        spacing: {
          '18': '4.5rem',
          '22': '5.5rem',
        },
        borderRadius: {
          'xl': '0.875rem',
          '2xl': '1.25rem',
          '3xl': '1.75rem',
        },
        boxShadow: {
          'card': '0 1px 3px 0 rgba(13, 34, 25, 0.06), 0 1px 2px -1px rgba(13, 34, 25, 0.06)',
          'card-hover': '0 4px 12px -2px rgba(13, 34, 25, 0.1), 0 2px 6px -2px rgba(13, 34, 25, 0.06)',
          'elevated': '0 12px 32px -4px rgba(13, 34, 25, 0.12), 0 4px 12px -2px rgba(13, 34, 25, 0.08)',
        },
        animation: {
          'fade-in': 'fadeIn 0.4s ease-out',
          'slide-up': 'slideUp 0.5s ease-out',
          'pulse-ring': 'pulseRing 2s ease-in-out infinite',
          'draw-gauge': 'drawGauge 1.2s ease-out forwards',
          'morph-in': 'morphIn 0.45s ease-out',
        },
        keyframes: {
          fadeIn: {
            '0%': { opacity: '0' },
            '100%': { opacity: '1' },
          },
          morphIn: {
            '0%': { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
            '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          },
          slideUp: {
            '0%': { opacity: '0', transform: 'translateY(12px)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
          pulseRing: {
            '0%, 100%': { transform: 'scale(1)', opacity: '1' },
            '50%': { transform: 'scale(1.05)', opacity: '0.85' },
          },
          drawGauge: {
            '0%': { strokeDashoffset: '628' },
            '100%': { strokeDashoffset: 'var(--final-offset)' },
          },
        },
      },
    },
  };
}
