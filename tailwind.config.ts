import type { Config } from 'tailwindcss';

/**
 * TrendeX tokens. Chrome is white/grey only; colour lives in the data.
 * Do not use arbitrary colours outside this palette.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      bg: '#FFFFFF',
      surface: '#FAFAFA',
      panel: '#F5F5F5',
      seg: '#F0F0F0',
      grid: '#EDEDED',
      hairline: '#E5E5E5',
      dim: '#E2E2E2',
      'border-strong': '#D4D4D4',
      text: '#171717',
      'text-hover': '#262626',
      'text-2': '#525252',
      'text-3': '#8A8A8A',
      disabled: '#A3A3A3',
      boundary: '#404040',
      district: '#737373',
      trend: {
        'dec-strong': '#C2410C',
        dec: '#FDBA74',
        nr: '#D4D4D8',
        'nr-hatch': '#A1A1AA',
        inc: '#99D5E0',
        'inc-strong': '#0E7490',
      },
      level: {
        low: '#DCEBD3',
        moderate: '#86C07F',
        good: '#2F7D3E',
      },
      excluded: '#52525B',
      nodata: '#A1A1AA',
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', 'sans-serif'],
    },
    fontSize: {
      '2xs': ['11px', { lineHeight: '16px', letterSpacing: '0.04em' }],
      xs: ['12px', '16px'],
      sm: ['13px', '18px'],
      base: ['14px', '20px'],
      md: ['16px', '24px'],
      lg: ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
      xl: ['28px', { lineHeight: '36px', letterSpacing: '-0.01em' }],
    },
    fontWeight: { normal: '400', medium: '500', semibold: '600' },
    borderRadius: {
      none: '0',
      xs: '2px',
      sm: '4px',
      DEFAULT: '6px',
      md: '6px',
      lg: '8px',
      xl: '12px',
      full: '9999px',
    },
    boxShadow: {
      none: 'none',
      float: '0 8px 24px rgba(0,0,0,.08)',
      drawer: '-12px 0 24px rgba(0,0,0,.04)',
      ring: '0 0 0 2px #171717',
      hair: '0 0 0 1px #E5E5E5',
    },
    extend: {
      height: { control: '32px', touch: '44px', bar: '48px', strip: '40px' },
      width: { rail: '280px', drawer: '400px', tour: '296px' },
      transitionDuration: { DEFAULT: '150ms' },
      transitionTimingFunction: { DEFAULT: 'ease' },
      maxWidth: { prose: '720px' },
    },
  },
  plugins: [],
};

export default config;
