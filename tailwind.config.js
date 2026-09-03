/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./frontend/**/*.{html,js}'],
  // Classes assembled at runtime from hex-color variables (e.g.
  // `bg-[${color}]/10` in dashboard.html) are listed literally here so
  // the static build always includes them, even though the exact string
  // never appears in the markup.
  safelist: [
    'bg-[#006038]/10',
    'bg-[#1a7a4c]/10',
    'bg-[#933302]/10',
    'bg-[#933302]/20',
    'bg-[#ba1a1a]/10',
    'bg-[#6f7a71]/10',
    'text-[#006038]',
    'text-[#1a7a4c]',
    'text-[#933302]',
    'text-[#ba1a1a]',
    'text-[#6f7a71]',
    'text-[#3f4941]',
    'text-[#1b1c1c]',
    'border-[#e4e2e1]',
    'border-[#ffb599]',
    'border-[#bec9bf]',
    'border-[#933302]/20',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
