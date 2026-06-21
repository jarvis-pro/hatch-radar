/**
 * db 包内部基础桶：生成的 Prisma client + 连接 + 行类型 + PG⇄域映射。
 *
 * 仓储 / runtime-settings 经此**相对**引用，而非用包名 `@/lib/db` 自引——
 * 对外总桶 index.ts 会在这些之上再导出仓储，若仓储再用包名自引，就和「index 再导出仓储」
 * 形成类型别名循环（TS2303/TS2308）。内部桶不含仓储，故无环。
 */
export * from './generated/prisma/client';
export * from './client';
export * from './types';
export * from './mappers';
export * from './hash';
