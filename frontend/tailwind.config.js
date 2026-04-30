/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'noc-bg':        '#050910',
        'noc-panel':     '#0c1118',
        'noc-border':    '#15202e',
        'noc-hover':     '#111a25',
        'noc-text':      '#dce4ec',
        'noc-text-dim':  '#5a6e80',
        'noc-text-mute': '#263040',
        'noc-accent':    '#00e699',
        'noc-warning':   '#ffaa22',
        'noc-critical':  '#ff3050',
        'noc-info':      '#2888ff',
        'noc-tts':       '#6c3dff',
        'noc-wmc':       '#ff8800',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
