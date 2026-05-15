import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Editorial palette — FT × Economist × Businessweek discipline.
        // Cream + ink + editorial red. That's it.
        cream: {
          DEFAULT: '#F5F2EC',
          50: '#FBFAF7',
          100: '#F5F2EC',
          200: '#EAE4D8',
        },
        ink: {
          DEFAULT: '#15161A',
          900: '#15161A',
          800: '#2A2C32',
          700: '#4A4D55',
          500: '#7B7F89',
          300: '#B6B9C1',
          // ink-100 controls every hairline divider, table border, and section
          // rule. Sits between ink-300 and ink-500 so the editorial hairlines
          // register clearly against the cream background.
          100: '#9DA1A8',
        },
        editorial: {
          DEFAULT: '#A8201A',
          dark: '#7E1813',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        editorial: '-0.015em',
        tight: '-0.01em',
      },
      fontSize: {
        // Editorial sizing — display headlines run big.
        'eyebrow': ['0.6875rem', { lineHeight: '1', letterSpacing: '0.12em' }],
        'deck': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.005em' }],
      },
      maxWidth: {
        'measure': '38rem', // body column ~75 char measure
        'page': '78rem',
      },
    },
  },
  plugins: [],
};

export default config;
