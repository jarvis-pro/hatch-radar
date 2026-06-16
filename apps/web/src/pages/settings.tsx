import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hatch-radar/ui/components/tabs';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import { PageHeader } from '@/components/page-header';
import {
  RuntimeSettingsManager,
  type RuntimeSettingsData,
} from '@/components/runtime-settings-manager';
import { SettingsManager, type SettingsData } from '@/components/settings-manager';
import { SourcesManager, type SourcesData } from '@/components/sources-manager';

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** 设置页内分区（持久化到 URL ?tab=，便于刷新/分享/回退） */
const TABS = ['models', 'sources', 'runtime'] as const;
type SettingsTab = (typeof TABS)[number];

function SettingsView() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('tab');
  const tab: SettingsTab = (TABS as readonly string[]).includes(raw ?? '')
    ? (raw as SettingsTab)
    : 'models';

  function selectTab(v: string) {
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', v);
        return next;
      },
      { replace: true },
    );
  }

  // 各分区按需懒加载：首屏只请求当前 tab，切到其它 tab 再拉取；
  // react-query 缓存使回切不重复请求（观察者常驻 SettingsView，切 tab 不卸载）。
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsData>('/settings'),
    enabled: tab === 'models',
  });
  const sourcesQ = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<SourcesData>('/sources'),
    enabled: tab === 'sources',
  });
  const runtimeQ = useQuery({
    queryKey: ['settings-runtime'],
    queryFn: () => api.get<RuntimeSettingsData>('/settings/runtime'),
    enabled: tab === 'runtime',
  });

  return (
    <>
      <PageHeader title="设置" description="模型与密钥 · 数据来源 · 运行参数" />

      <Tabs value={tab} onValueChange={selectTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="models">模型与密钥</TabsTrigger>
          <TabsTrigger value="sources">数据来源</TabsTrigger>
          <TabsTrigger value="runtime">运行参数</TabsTrigger>
        </TabsList>

        <TabsContent value="models">
          {settingsQ.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <SettingsManager
              initial={settingsQ.data ?? null}
              loadError={settingsQ.isError ? errMsg(settingsQ.error, '加载模型设置失败') : null}
              onChanged={() => qc.invalidateQueries({ queryKey: ['settings'] })}
            />
          )}
        </TabsContent>

        <TabsContent value="sources">
          {sourcesQ.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <SourcesManager
              initial={sourcesQ.data ?? null}
              loadError={sourcesQ.isError ? errMsg(sourcesQ.error, '加载数据来源失败') : null}
              onChanged={() => qc.invalidateQueries({ queryKey: ['sources'] })}
            />
          )}
        </TabsContent>

        <TabsContent value="runtime">
          {runtimeQ.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <RuntimeSettingsManager
              initial={runtimeQ.data ?? null}
              loadError={runtimeQ.isError ? errMsg(runtimeQ.error, '加载运行期参数失败') : null}
              onChanged={() => qc.invalidateQueries({ queryKey: ['settings-runtime'] })}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

/** 设置页（settings:manage）：Tabs 分区——模型与密钥 / 数据来源 / 运行参数。 */
export function SettingsPage() {
  return (
    <RequirePerm perm="settings:manage">
      <SettingsView />
    </RequirePerm>
  );
}
