import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { AppConfigModule } from '../config/app-config.module';
import { DatabaseModule } from '../database/database.module';
import { RepositoriesModule } from '../db/repositories.module';
import { ExportModule } from '../export/export.module';

/**
 * CLI 根模块（无 HTTP / 调度 / worker）：一次性命令复用与运行进程相同的服务与仓储，
 * 不再是独立的进程级写库者——回到字面意义的单写者拓扑。
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, RepositoriesModule, AnalysisModule, ExportModule],
})
export class CliModule {}
