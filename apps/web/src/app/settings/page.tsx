import { SettingsManager, type SettingsData } from '@/components/settings-manager';
import { serverApiFetch } from '@/lib/server-api';
import { requirePermission } from '@/lib/auth/guards';
import { Forbidden } from '@/components/forbidden';

export const dynamic = 'force-dynamic';

export const metadata = { title: '模型设置' };

/**
 * 设置页（服务端壳）：经 server API 取脱敏的模型清单与 active 选择，交给客户端组件管理。
 * 密钥读写一律走 server（web 不直读密钥），故此处不用 lib/db 直读。
 */
export default async function SettingsPage() {
  const { allowed } = await requirePermission('settings:manage');
  if (!allowed) return <Forbidden />;
  let initial: SettingsData | null = null;
  let loadError: string | null = null;
  try {
    const resp = await serverApiFetch('/api/settings');
    if (resp.ok) initial = (await resp.json()) as SettingsData;
    else loadError = `加载设置失败（${resp.status}）`;
  } catch {
    loadError =
      '无法连接工作台 server 进程（默认 http://localhost:8787，可用 SERVER_API_URL 覆盖）';
  }
  return <SettingsManager initial={initial} loadError={loadError} />;
}
