/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Luckiest Guy"', 'cursive'],
        body: ['Poppins', 'sans-serif'],
        // V1 Operator redesign type stack
        geist: ['Geist', 'system-ui', 'sans-serif'],
        brand: ['"Lilita One"', 'cursive'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // V1 Operator — dark (primary)
        op: {
          bg: '#0a0f1a',
          panel: '#101826',
          panelHi: '#16203a',
          border: 'rgba(255,255,255,0.06)',
          borderHi: 'rgba(255,255,255,0.1)',
          ink: '#e7ecf3',
          inkDim: '#8893a7',
          inkDimmer: '#5a6478',
          good: '#22c55e',
          bad: '#ef4444',
          warn: '#f59e0b',
          sidebar: '#070b14',
          glass: 'rgba(22,32,58,0.55)',
        },
        // V1 Operator — light
        opl: {
          bg: '#f4f3ee',
          panel: '#ffffff',
          panelHi: '#fafaf6',
          ink: '#14110a',
          inkDim: '#6b6453',
          sidebar: '#ece8dc',
          bad: '#c0392b',
        },
        // Selectable accents (README)
        accent: {
          green: '#22c55e',
          emerald: '#10b981',
          lime: '#b5ff3c',
          blue: '#3b82f6',
          amber: '#f59e0b',
          pink: '#ec4899',
          violet: '#8b5cf6',
        },
      },
      borderRadius: {
        card: '16px',
      },
      spacing: {
        // V1 "comfortable" density
        card: '24px',
        gridgap: '18px',
      },
    }
  },
  plugins: [],
}
