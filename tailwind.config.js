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
        // V1 Operator — dark (primary).
        //
        // These are indirected through CSS variables so the pure-black
        // (OLED) theme can re-point them in one place. The variable VALUES
        // live in index.html's first <style> block: `:root` carries the dark
        // hexes below, `html.oled` carries the black ones. Everything that
        // writes `dark:bg-op-panel` retints for free, transparency variants
        // (`dark:bg-op-panel/50`) included.
        //
        // Space-separated channels, not hex — that is what the
        // `<alpha-value>` placeholder needs to compose `/opacity` modifiers.
        // The three tokens that are already translucent take a plain var()
        // instead: a fixed alpha and `<alpha-value>` cannot coexist, and
        // nothing writes `border-op-border/50`.
        op: {
          bg: 'rgb(var(--op-bg) / <alpha-value>)',            // #0a0f1a
          panel: 'rgb(var(--op-panel) / <alpha-value>)',      // #101826
          panelHi: 'rgb(var(--op-panelHi) / <alpha-value>)',  // #16203a
          border: 'var(--op-border)',                         // rgba(255,255,255,0.06)
          borderHi: 'var(--op-borderHi)',                     // rgba(255,255,255,0.1)
          ink: 'rgb(var(--op-ink) / <alpha-value>)',          // #e7ecf3
          inkDim: 'rgb(var(--op-inkDim) / <alpha-value>)',    // #8893a7
          inkDimmer: 'rgb(var(--op-inkDimmer) / <alpha-value>)', // #5a6478
          // Semantic colours are identical in both dark themes — they clear
          // 4.5:1 on #0a0a0a as they do on #101826 — so they stay literal.
          good: '#22c55e',
          bad: '#ef4444',
          warn: '#f59e0b',
          sidebar: 'rgb(var(--op-sidebar) / <alpha-value>)',  // #070b14
          glass: 'var(--op-glass)',                           // rgba(22,32,58,0.55)
        },
        // V1 Operator — light
        opl: {
          bg: '#f4f3ee',
          panel: '#ffffff',
          panelHi: '#fafaf6',
          ink: '#14110a',
          inkDim: '#6b6453',
          inkDimmer: '#9c9484',
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
