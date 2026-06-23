import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { SessionAuthGuard } from './session-auth.guard';

/**
 * 账户上下文：人鉴权权威服务（AccountService）+ 全局会话守卫 + 账户端点。
 *
 * 路由分工：本模块 AccountController 持 `/api/auth/*`（人/会话：登录 / 登出 / 校验 / 改密 / 会话管理 / 资料）。
 *
 * SessionAuthGuard 经 APP_GUARD 注册为**全局守卫**（fail-closed）：全仓路由默认要求有效会话，
 * 公开端点以 @Public 显式豁免——其余模块无须再为鉴权 import 本模块、也无须逐控制器 @UseGuards。
 * 守卫实例在本模块上下文实例化，可注入 AccountService（会话解析）与 Reflector（@Public / 能力闸元数据）。
 *
 * AccountService 为叶子（仅依赖全局仓储 / RuntimeSettings / TxContext），故本模块不 import 其它领域模块。
 */
@Module({
  controllers: [AccountController],
  providers: [AccountService, { provide: APP_GUARD, useClass: SessionAuthGuard }],
  exports: [AccountService],
})
export class AccountModule {}
