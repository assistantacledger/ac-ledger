import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#1a1a1a',
        paper: '#f8f8f6',
        cream: '#f0f0ee',
        rule: '#e2e2e0',
        muted: '#9a9a9a',
        sidebar: '#181818',
        'ac-green': '#3a7a5a',
        'ac-green-pale': '#eef5f1',
        'ac-amber': '#7a6a3a',
        'ac-amber-pale': '#f5f2e8',
        // Dark mode equivalents
        'dark-paper': '#141414',
        'dark-cream': '#1e1e1e',
        'dark-rule': '#2a2a2a',
      },
      fontFamily: {
        sans: ['Outfit', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0px',
        sm: '2px',
        md: '2px',
        lg: '2px',
        xl: '2px',
      },
    },
  },
  plugins: [],
}

export default config
