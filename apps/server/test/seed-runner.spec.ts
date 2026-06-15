import { describe, expect, it } from 'vitest';
import { SeedRunner } from '@/seed/seed.runner';
import type { Seeder, SeedContext, SeedOutcome } from '@/seed/seeder';

const skipped = (): SeedOutcome => ({ status: 'skipped', reason: 't' });

function mk(name: string, order: number, critical: boolean, run: Seeder['run']): Seeder {
  return { name, order, critical, run };
}

describe('SeedRunner', () => {
  it('按 order 升序串行驱动（与登记顺序无关）', async () => {
    const calls: string[] = [];
    const a = mk('a', 20, false, async () => {
      calls.push('a');
      return skipped();
    });
    const b = mk('b', 10, false, async () => {
      calls.push('b');
      return skipped();
    });
    await new SeedRunner([a, b]).onApplicationBootstrap();
    expect(calls).toEqual(['b', 'a']);
  });

  it('critical 失败 → 向上抛中止，后续不执行', async () => {
    const calls: string[] = [];
    const crit = mk('crit', 10, true, () => Promise.reject(new Error('boom')));
    const after = mk('after', 20, false, async () => {
      calls.push('after');
      return skipped();
    });
    await expect(new SeedRunner([crit, after]).onApplicationBootstrap()).rejects.toThrow('boom');
    expect(calls).toEqual([]);
  });

  it('non-critical 失败 → 吞掉并继续后续', async () => {
    const calls: string[] = [];
    const bad = mk('bad', 10, false, () => Promise.reject(new Error('x')));
    const good = mk('good', 20, false, async () => {
      calls.push('good');
      return skipped();
    });
    await new SeedRunner([bad, good]).onApplicationBootstrap();
    expect(calls).toEqual(['good']);
  });

  it('ctx.now 对所有 Seeder 同值且为整数', async () => {
    const nows: number[] = [];
    const push = async (ctx: SeedContext): Promise<SeedOutcome> => {
      nows.push(ctx.now);
      return skipped();
    };
    await new SeedRunner([mk('a', 10, false, push), mk('b', 20, false, push)]).onApplicationBootstrap();
    expect(nows[0]).toBe(nows[1]);
    expect(Number.isInteger(nows[0])).toBe(true);
  });
});
