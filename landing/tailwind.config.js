/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // From CropSathi DESIGN.md
        primary: {
          DEFAULT: '#006038',
          container: '#1a7a4c',
          on: '#ffffff',
          'on-container': '#abffc9',
          fixed: '#9bf6bd',
          'fixed-dim': '#80d9a2',
        },
        tertiary: {
          DEFAULT: '#933302',
          container: '#b44a1b',
          on: '#ffffff',
          'on-container': '#ffe8e1',
          fixed: '#ffdbce',
          'fixed-dim': '#ffb599',
        },
        surface: {
          DEFAULT: '#fbf9f8',
          dim: '#dcd9d9',
          bright: '#fbf9f8',
          'lowest': '#ffffff',
          'low': '#f6f3f2',
          'container': '#f0eded',
          'high': '#eae8e7',
          'highest': '#e4e2e1',
        },
        'on-surface': {
          DEFAULT: '#1b1c1c',
          variant: '#3f4941',
        },
        outline: {
          DEFAULT: '#6f7a71',
          variant: '#bec9bf',
        },
        secondary: {
          DEFAULT: '#5f5f5a',
          container: '#e1e0da',
          on: '#ffffff',
          'on-container': '#63635e',
        },
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
          on: '#ffffff',
          'on-container': '#93000a',
        },
      },
      fontFamily: {
        sans: ['Noto Sans', 'system-ui', 'sans-serif'],
        display: ['Be Vietnam Pro', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-up': 'fade-up 0.7s ease-out forwards',
        'fade-in': 'fade-in 0.7s ease-out forwards',
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 4s ease-in-out infinite',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
      },
    },
  },
  plugins: [],
};
