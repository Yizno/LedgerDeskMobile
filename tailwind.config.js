/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.2rem',
      },
    },
  },
  plugins: [],
};
