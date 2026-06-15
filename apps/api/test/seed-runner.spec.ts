import { describe, expect, it } from 'vitest';
import { SeedRunner } from '@/domain/seed/seed.runner';
import type { RuntimeSettingsSeeder } from '@/domain/seed/runtime-settings.seeder';
import type { Seeder, SeedContext, SeedOutcome } from '@/domain/seed/seeder';
import type { SourcesSeeder } from '@/domain/seed/sources.seeder';
import type { SuperAdminSeeder } from '@/domain/seed/super-admin.seeder';

const NOW = 1_700_000_000;
const skipped = (): SeedOutcome => ({ status: 'skipped', reason: 't' });

function mk(name: string, order: number, critical: boolean, run: Seeder['run']): Seeder {
  return { name, order, critical, run };
}

/**
 * SeedRunner 构造取三个具体 Seeder（与 createCore 装配一致）；它内部仅按 Seeder 接口
 * （name/order/critical/run）使用之，故测试用 mock 充当三个位置即可——顺序无关，由 order 决定执行序。
 */
function runner(a: Seeder, b: Seeder, c: Seeder): SeedRunner {
  return new SeedRunner(
    a as unknown as SourcesSeeder,
    b as unknown as SuperAdminSeeder,
    c as unknown as RuntimeSettingsSeeder,
  );
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
    const c = mk('c', 30, false, async () => {
      calls.push('c');
      return skipped();
    });
    await runner(a, b, c).run(NOW);
    expect(calls).toEqual(['b', 'a', 'c']);
  });

  it('critical 失败 → 向上抛中止，后续不执行', async () => {
    const calls: string[] = [];
    const crit = mk('crit', 10, true, () => Promise.reject(new Error('boom')));
    const after = mk('after', 20, false, async () => {
      calls.push('after');
      return skipped();
    });
    const last = mk('last', 30, false, async () => {
      calls.push('last');
      return skipped();
    });
    await expect(runner(crit, after, last).run(NOW)).rejects.toThrow('boom');
    expect(calls).toEqual([]);
  });

  it('non-critical 失败 → 吞掉并继续后续', async () => {
    const calls: string[] = [];
    const bad = mk('bad', 10, false, () => Promise.reject(new Error('x')));
    const good = mk('good', 20, false, async () => {
      calls.push('good');
      return skipped();
    });
    const more = mk('more', 30, false, async () => {
      calls.push('more');
      return skipped();
    });
    await runner(bad, good, more).run(NOW);
    expect(calls).toEqual(['good', 'more']);
  });

  it('run(now) 把同一 now 下传给所有 Seeder', async () => {
    const nows: number[] = [];
    const push = async (ctx: SeedContext): Promise<SeedOutcome> => {
      nows.push(ctx.now);
      return skipped();
    };
    await runner(mk('a', 10, false, push), mk('b', 20, false, push), mk('c', 30, false, push)).run(
      NOW,
    );
    expect(nows).toEqual([NOW, NOW, NOW]);
    expect(Number.isInteger(nows[0])).toBe(true);
  });
});
