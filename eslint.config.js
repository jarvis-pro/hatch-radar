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
          if (!source || typeof source.value !== 'string') {
            return;
          }

          // 只管父级跳转；同目录 ./ 不动
          const value = source.value;
          if (!value.startsWith('../')) {
            return;
          }

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
      // 强制控制流语句（if/else/for/while/do）一律带花括号，禁止无大括号单行式——
      // 防后续加第二行语句漏加花括号导致 bug（参 Apple goto fail）。Prettier 不增删花括号，故此处可强制。
      curly: ['error', 'all'],
      // 强制垂直留白：块语句（含卫语句 if 块）后空一行、return 前空一行——
      // 异常路径与主逻辑视觉分段。Prettier 只收敛多余空行、不强制「该空处必空」，故由此规则补位。
      // 核心 stylistic 规则在 ESLint 10 标记 deprecated 但仍可用且可 autofix；如未来移除再迁 @stylistic。
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
    },
  },
  {
    // Expo config plugins & 构建链配置（babel/metro/tailwind）是 CommonJS
    // （apps/mobile、apps/lumen 无 "type": "module"），由 Expo CLI / Metro 以 require() 加载。
    files: [
      'apps/mobile/plugins/**/*.js',
      'apps/mobile/*.config.js',
      'apps/lumen/plugins/**/*.js',
      'apps/lumen/*.config.js',
    ],
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
  // ── 分层护栏（apps/api）：modules → domain → lib 单向，防跨层反向依赖（审计 #21）──────────
  // 用内置 no-restricted-imports + files scope（ESLint 10 可靠；eslint-plugin-boundaries 在 ESLint 10
  // 崩，故沿用本仓「内置/自写规则」路线）。跨层必是跨目录、按约定走 @/ 别名，按别名前缀拦截即可。
  // 注：lib 子层次序（kernel←db←crawler/analysis/auth）与领域服务相对路径互引混用 ../，不宜用别名
  // pattern 强制，留待 dependency-cruiser；此处先固化最关键的「不可反向跨层」。
  {
    files: ['apps/api/src/lib/**/*.ts'],
    ignores: ['apps/api/src/lib/db/generated/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/domain', '@/domain/*', '@/modules', '@/modules/*'],
              message:
                'lib（能力 / 适配层）不可依赖 domain / modules——依赖方向应为 modules → domain → lib。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules', '@/modules/*'],
              message:
                'domain（领域层）不可依赖 modules（HTTP / wiring 层）——控制器依赖领域服务，反之不可。',
            },
          ],
        },
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
      'apps/lumen/ios/',
      'apps/lumen/android/',
    ],
  },
);
