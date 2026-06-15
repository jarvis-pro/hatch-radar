import { Module } from '@nestjs/common';
import { RepositoriesModule } from '@/db/repositories.module';
import { RuntimeSettingsService } from './runtime-settings.service';

/**
 * 运行期设置模块：提供 {@link RuntimeSettingsService}（DB 覆盖优先、env 默认兜底）。
 * 需要这些运行期可调项的模块（account / worker / scheduler / http）import 本模块即可注入。
 * 依赖 SettingsRepository（RepositoriesModule）与全局 APP_ENV（AppConfigModule）。
 */
@Module({
  imports: [RepositoriesModule],
  providers: [RuntimeSettingsService],
  exports: [RuntimeSettingsService],
})
export class RuntimeSettingsModule {}
