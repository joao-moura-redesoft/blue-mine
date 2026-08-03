/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Inter como fonte principal (sans), com fallback para a stack do sistema
        // caso o Google Fonts não carregue (offline / CSP).
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      // Elevação em duas camadas (contato + difusa) e com tinta slate em vez de
      // preto puro — o padrão do Tailwind fica cinza e "chapado" sobre bg-slate-50.
      boxShadow: {
        sm: '0 1px 2px rgba(15, 23, 42, 0.05), 0 1px 1px rgba(15, 23, 42, 0.03)',
        DEFAULT: '0 1px 2px rgba(15, 23, 42, 0.05), 0 2px 6px rgba(15, 23, 42, 0.06)',
        md: '0 2px 4px rgba(15, 23, 42, 0.05), 0 6px 14px rgba(15, 23, 42, 0.07)',
        lg: '0 3px 6px rgba(15, 23, 42, 0.05), 0 12px 28px rgba(15, 23, 42, 0.08)',
        xl: '0 6px 12px rgba(15, 23, 42, 0.06), 0 22px 44px rgba(15, 23, 42, 0.1)',
        '2xl': '0 12px 24px rgba(15, 23, 42, 0.1), 0 36px 72px rgba(15, 23, 42, 0.16)',
      },
    },
  },
  plugins: [],
};
