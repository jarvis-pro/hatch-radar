const { hairlineWidth } = require('nativewind/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        signal: {
          DEFAULT: 'hsl(var(--signal))',
          foreground: 'hsl(var(--signal-foreground))',
        },
        intensity: {
          high: 'hsl(var(--intensity-high))',
          'high-foreground': 'hsl(var(--intensity-high-foreground))',
          medium: 'hsl(var(--intensity-medium))',
          'medium-foreground': 'hsl(var(--intensity-medium-foreground))',
          low: 'hsl(var(--intensity-low))',
          'low-foreground': 'hsl(var(--intensity-low-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      /*
       * RN 自定义字体不做合成字重：每个字重是独立 family（@expo-google-fonts）。
       * 故按「字重→字体族」拆类（名字避开 Tailwind 内置 font-{weight}）：
       *   正文 font-sans / 中 font-sans-md / 半粗 font-sans-sb / 粗 font-sans-bd
       *   等宽 font-mono（数值·ID·计数）/ font-mono-sb
       */
      fontFamily: {
        sans: ['Inter_400Regular'],
        'sans-md': ['Inter_500Medium'],
        'sans-sb': ['Inter_600SemiBold'],
        'sans-bd': ['Inter_700Bold'],
        mono: ['JetBrainsMono_400Regular'],
        'mono-sb': ['JetBrainsMono_600SemiBold'],
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require('tailwindcss-animate')],
};
