import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  {
    // Expo config plugins & 构建链配置（babel/metro/tailwind）是 CommonJS
    // （apps/mobile 无 "type": "module"），由 Expo CLI / Metro 以 require() 加载。
    files: ['apps/mobile/plugins/**/*.js', 'apps/mobile/*.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/.next/',
      '**/.expo/',
      '**/next-env.d.ts',
      'apps/mobile/ios/',
      'apps/mobile/android/',
    ],
  },
);
