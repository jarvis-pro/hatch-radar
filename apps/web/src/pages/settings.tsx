import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import { api, ApiError } from '@/api/client';
import { RequirePerm } from '@/auth/require-perm';
import {
  RuntimeSettingsManager,
  type RuntimeSettingsData,
} from '@/components/runtime-settings-manager';
import { SettingsManager, type SettingsData } from '@/components/settings-manager';
import { SourcesManager, type SourcesData } from '@/components/sources-manager';

function errMsg(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function SettingsView() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsData>('/settings'),
  });
  const sourcesQ = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<SourcesData>('/sources'),
  });
  const runtimeQ = useQuery({
    queryKey: ['settings-runtime'],
    queryFn: () => api.get<RuntimeSettingsData>('/settings/runtime'),
  });

  return (
    <>
      {settingsQ.isPending ? (
        <Skeleton className="mb-10 h-48 w-full" />
      ) : (
        <SettingsManager
          initial={settingsQ.data ?? null}
          loadError={settingsQ.isError ? errMsg(settingsQ.error, '加载模型设置失败') : null}
          onChanged={() => qc.invalidateQueries({ queryKey: ['settings'] })}
        />
      )}

      {sourcesQ.isPending ? (
        <Skeleton className="mt-10 h-48 w-full" />
      ) : (
        <SourcesManager
          initial={sourcesQ.data ?? null}
          loadError={sourcesQ.isError ? errMsg(sourcesQ.error, '加载数据来源失败') : null}
          onChanged={() => qc.invalidateQueries({ queryKey: ['sources'] })}
        />
      )}

      {runtimeQ.isPending ? (
        <Skeleton className="mt-10 h-48 w-full" />
      ) : (
        <RuntimeSettingsManager
          initial={runtimeQ.data ?? null}
          loadError={runtimeQ.isError ? errMsg(runtimeQ.error, '加载运行期参数失败') : null}
          onChanged={() => qc.invalidateQueries({ queryKey: ['settings-runtime'] })}
        />
      )}
    </>
  );
}

/** 设置页（settings:manage）：模型与密钥管理 + 数据来源 / 采集连接器。 */
export function SettingsPage() {
  return (
    <RequirePerm perm="settings:manage">
      <SettingsView />
    </RequirePerm>
  );
}
