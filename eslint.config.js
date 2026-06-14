import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// 仓库根：本文件就在根，故不依赖 ESLint 的 cwd（无论从哪个目录跑都正确）。
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * 内联规则：禁止「跨目录」相对导入（../...），自动修成别名（如 @/...）；
 * 同目录（./...）放行。等价于 eslint-plugin-no-relative-import-paths，但用
 * ESLint 9+/10 的 context.cwd / context.filename，且 rootDir 传绝对路径。
 *
 * 选项：{ rootDirAbs: string（别名根的绝对路径）, prefix: string（别名前缀，如 '@'）}
 */
const importPathPlugin = {
  rules: {
    'no-relative-parent-imports': {
      meta: {
        type: 'suggestion',
        fixable: 'code',
        schema: [
          {
            type: 'object',
            properties: { rootDirAbs: { type: 'string' }, prefix: { type: 'string' } },
            additionalProperties: false,
          },
        ],
        messages: {
          useAlias: "跨目录导入请用别名 '{{alias}}'，不要用相对路径 '{{source}}'",
        },
      },
      create(context) {
        const { rootDirAbs = '', prefix = '' } = context.options[0] ?? {};
        const fileDir = path.dirname(context.filename);
        const check = (node) => {
          const source = node.source;
          if (!source || typeof source.value !== 'string') return;
          const value = source.value;
          if (!value.startsWith('../')) return; // 只管父级跳转；同目录 ./ 不动
          const parts = path.relative(rootDirAbs, path.resolve(fileDir, value)).split(path.sep);
          const alias = [prefix, ...parts].filter(Boolean).join('/');
          // 解析后仍跳出别名根（出现 ..）则只报错不自动修，避免生成坏路径
          const canFix = parts[0] !== '..';
          context.report({
            node: source,
            messageId: 'useAlias',
            data: { alias, source: value },
            fix: canFix ? (fixer) => fixer.replaceText(source, `'${alias}'`) : null,
          });
        };
        return {
          ImportDeclaration: check, // import ... from '../x'
          ExportNamedDeclaration: check, // export { x } from '../x'
          ExportAllDeclaration: check, // export * from '../x'
        };
      },
    },
  },
};

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
    // apps/server 导入约定：跨目录用 @/（映射 apps/server/src），同目录保留 ./
    // 仅限 server —— web 的 @/ 指 web 自己的 src、mobile 又是另一套，故按路径 scope。
    files: ['apps/server/**/*.ts'],
    plugins: { 'import-path': importPathPlugin },
    rules: {
      'import-path/no-relative-parent-imports': [
        'error',
        { rootDirAbs: path.join(repoRoot, 'apps/server/src'), prefix: '@' },
      ],
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
