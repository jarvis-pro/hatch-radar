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

/**
 * 内联规则（仅 apps/api）：构造函数每个参数「上一行」必须有独占一行的 `//` 注释，说明该依赖 / 入参的角色。
 * 副作用即目的——行注释让 Prettier 无法把参数列表合并成一行，从而强制「每个参数独占一行」的排版。
 * 无 autofix：缺注释即报错，强制人工补真实说明（不接受占位）。仅查「存在性 + 独占一行」，内容质量靠 review。
 */
const constructorDocsPlugin = {
  rules: {
    'require-constructor-param-comment': {
      meta: {
        type: 'suggestion',
        docs: { description: '构造函数每个参数上一行须有独占的 // 注释' },
        schema: [],
        messages: {
          missing:
            "构造函数参数 '{{name}}' 上一行缺少 // 注释（apps/api 约定：每个构造参数独占一行、上一行用 // 说明其角色）",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode;
        // 「独占一行的行注释」：是 Line(`//`) 注释，且其前一个 token/注释在更早的行（即它自起一行，排除行尾注释）。
        const isOwnLineLineComment = (comment) => {
          if (comment.type !== 'Line') {
            return false;
          }

          const before = sourceCode.getTokenBefore(comment, { includeComments: true });

          return !before || before.loc.end.line < comment.loc.start.line;
        };

        const nameOf = (param) => {
          const node = param.type === 'TSParameterProperty' ? param.parameter : param;
          if (node?.type === 'Identifier') {
            return node.name;
          }

          if (node?.type === 'AssignmentPattern' && node.left?.type === 'Identifier') {
            return node.left.name;
          }

          return '(参数)';
        };

        return {
          'MethodDefinition[kind="constructor"]'(node) {
            const params = node.value?.params ?? [];
            for (const param of params) {
              if (!sourceCode.getCommentsBefore(param).some(isOwnLineLineComment)) {
                context.report({
                  node: param,
                  messageId: 'missing',
                  data: { name: nameOf(param) },
                });
              }
            }
          },
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
    // apps/api 导入约定：跨目录用 @/（映射 apps/api/src），同目录保留 ./
    // 仅限 api —— web 的 @/ 指 web 自己的 src、mobile 又是另一套，故按路径 scope。
    // 生成代码（Prisma client）走相对互引、不归此约定，排除。
    files: ['apps/api/**/*.ts'],
    ignores: ['apps/api/src/database/generated/**'],
    plugins: { 'import-path': importPathPlugin },
    rules: {
      'import-path/no-relative-parent-imports': [
        'error',
        { rootDirAbs: path.join(repoRoot, 'apps/api/src'), prefix: '@' },
      ],
    },
  },
  {
    // apps/api 约定：构造函数每个参数独占一行 + 上一行 `//` 注释（用注释逼出独行排版 + 标注每个依赖角色）。
    // 仅 apps/api/src（不含生成代码）；测试不强制。无 autofix——缺注释即报错，须人工补真实说明。
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/database/generated/**'],
    plugins: { 'api-conventions': constructorDocsPlugin },
    rules: {
      'api-conventions/require-constructor-param-comment': 'error',
    },
  },
  // ── 分层护栏（apps/api）：能力 / 基座层不得反向依赖 modules，防跨层反向耦合 ────────────────
  // 用内置 no-restricted-imports + files scope（ESLint 10 可靠；eslint-plugin-boundaries 在 ESLint 10
  // 崩，故沿用本仓「内置/自写规则」路线）。lib / domain 层已解散（能力层下沉 src 根、领域服务
  // collocate 进 modules），旧 lib/domain 守卫退役，收敛为这一条「能力层不可向上依赖 modules」。
  {
    files: [
      'apps/api/src/database/**/*.ts',
      'apps/api/src/crawler/**/*.ts',
      'apps/api/src/analysis/**/*.ts',
      'apps/api/src/auth/**/*.ts',
      'apps/api/src/utils/**/*.ts',
      'apps/api/src/config/**/*.ts',
    ],
    ignores: ['apps/api/src/database/generated/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules', '@/modules/*'],
              message:
                '能力 / 基座层不可依赖 modules（HTTP / wiring / 领域服务层）——依赖方向应为 modules → 能力层 → 基座。',
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
      'apps/api/src/database/generated/',
      'apps/mobile/ios/',
      'apps/mobile/android/',
      'apps/lumen/ios/',
      'apps/lumen/android/',
    ],
  },
);
