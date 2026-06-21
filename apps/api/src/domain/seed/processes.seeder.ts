import { Injectable } from '@nestjs/common';
import { BlueprintsRepository, ProcessesRepository } from '@/lib/db';
import type { Seeder, SeedContext, SeedOutcome } from './seeder';

/** 默认进程触发间隔（秒）：采集 / 复查均每 30 分钟一轮（对齐旧 cron 0,30 / 10,40 的节奏）。 */
const DEFAULT_INTERVAL_SEC = 1800;

/**
 * 首启进程（幂等）：processes 表空时为默认采集 / 复查图纸各建一个 interval 进程，
 * status=active、next_run_at=ctx.now（首个调度心跳即触发，取代旧 runInitialRound）。
 * non-critical。order 18（晚于 blueprints，以便绑定其 id）。
 */
@Injectable()
export class ProcessesSeeder implements Seeder {
  readonly name = 'processes';
  readonly order = 18;
  readonly critical = false;

  constructor(
    private readonly processes: ProcessesRepository,
    private readonly blueprints: BlueprintsRepository,
  ) {}

  async run(ctx: SeedContext): Promise<SeedOutcome> {
    if ((await this.processes.listProcesses()).length > 0) {
      return { status: 'skipped', reason: 'processes 表非空' };
    }
    const collect = (await this.blueprints.listBlueprints('collect'))[0];
    const recheck = (await this.blueprints.listBlueprints('recheck'))[0];
    if (!collect && !recheck) {
      return { status: 'skipped', reason: '无可绑定的采集 / 复查图纸' };
    }
    let created = 0;
    for (const [bp, label] of [
      [collect, '采集 · 每 30 分钟'],
      [recheck, '复查 · 每 30 分钟'],
    ] as const) {
      if (!bp) continue;
      await this.processes.createProcess(
        {
          blueprintId: bp.id,
          label,
          triggerKind: 'interval',
          triggerConfig: { everySec: DEFAULT_INTERVAL_SEC },
          status: 'active',
          nextRunAt: ctx.now,
        },
        ctx.now,
      );
      created += 1;
    }
    return { status: 'seeded', detail: `${created} 个 interval 进程（采集 / 复查）` };
  }
}
