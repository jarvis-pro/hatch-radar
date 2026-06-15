import { SettingsManager, type SettingsData } from '@/components/settings-manager';
import { SourcesManager, type SourcesData } from '@/components/sources-manager';
import { serverApiFetch } from '@/lib/server-api';
import { requirePermission } from '@/lib/auth/guards';
import { Forbidden } from '@/components/forbidden';

export const dynamic = 'force-dynamic';

export const metadata = { title: '设置' };

const CONN_ERR =
  '无法连接工作台 server 进程（默认 http://localhost:8787，可用 SERVER_API_URL 覆盖）';

/**
 * 设置页（服务端壳）：经 server API 取脱敏的模型清单与数据来源/连接器，交给客户端组件管理。
 * 密钥/凭据读写一律走 server（web 不直读），故此处不用 lib/db 直读。
 */
export default async function SettingsPage() {
  const { allowed } = await requirePermission('settings:manage');
  if (!allowed) return <Forbidden />;

  let settings: SettingsData | null = null;
  let settingsError: string | null = null;
  try {
    const resp = await serverApiFetch('/api/settings');
    if (resp.ok) settings = (await resp.json()) as SettingsData;
    else settingsError = `加载模型设置失败（${resp.status}）`;
  } catch {
    settingsError = CONN_ERR;
  }

  let sources: SourcesData | null = null;
  let sourcesError: string | null = null;
  try {
    const resp = await serverApiFetch('/api/sources');
    if (resp.ok) sources = (await resp.json()) as SourcesData;
    else sourcesError = `加载数据来源失败（${resp.status}）`;
  } catch {
    sourcesError = CONN_ERR;
  }

  return (
    <>
      <SettingsManager initial={settings} loadError={settingsError} />
      <SourcesManager initial={sources} loadError={sourcesError} />
    </>
  );
}
