import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          900: '#312e81',
        },
        reachGreen: {
          50: '#e8f8f2',
          100: '#d1f1e5',
          500: '#00a86b',
          600: '#00925d',
          700: '#007a4e',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
