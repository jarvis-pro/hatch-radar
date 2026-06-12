/** 共享 PostCSS 配置：消费方应用 re-export 即可（保证 Tailwind 版本与配置统一在 ui 包内维护） */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
