import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Monitor, Smartphone, Terminal, type LucideIcon } from 'lucide-react';
import type { SessionInfo } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { cn } from '@hatch-radar/ui/lib/utils';
import { api } from '@/api/client';
import { PageHeader } from '@/components/page-header';
import { timeAgo } from '@/lib/format';
import { parseUserAgent, type DeviceKind } from '@/lib/user-agent';

const DEVICE_ICON: Record<DeviceKind, LucideIcon> = {
  desktop: Monitor,
  mobile: Smartphone,
  cli: Terminal,
  unknown: Globe,
};

/** 个人中心 · 会话：查看并吊销活跃登录会话。 */
export function SessionsPage() {
  return (
    <div>
      <PageHeader title="会话" description="当前账户的活跃登录会话" />
      <SessionList />
    </div>
  );
}

function SessionList() {
  const qc = useQueryClient();
  const sessionsQ = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionInfo[]>('/auth/sessions'),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['sessions'] });
  const revokeOne = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: invalidate,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.post('/auth/sessions/revoke-others'),
    onSuccess: invalidate,
  });

  const sessions = sessionsQ.data ?? [];
  const others = sessions.filter((s) => !s.current).length;
  const pending = revokeOne.isPending || revokeOthers.isPending;

  // 当前会话置顶，其余按最近活跃倒序。
  const ordered = [...sessions].sort((a, b) =>
    a.current === b.current ? b.lastSeenAt - a.lastSeenAt : a.current ? -1 : 1,
  );

  if (sessionsQ.isPending) {
    return <Spinner className="size-5 text-muted-foreground" />;
  }

  return (
    <div className="max-w-xl space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">活跃会话（{sessions.length}）</h2>
        {others > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() => revokeOthers.mutate()}
          >
            登出其他会话
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        {ordered.map((s) => {
          const ua = parseUserAgent(s.userAgent);
          const Icon = DEVICE_ICON[ua.kind];
          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm',
                s.current && 'border-primary/30 bg-primary/5',
              )}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{ua.label}</span>
                  {s.current ? (
                    <Badge variant="secondary" className="shrink-0">
                      本次会话
                    </Badge>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {s.ip ? `${s.ip} · ` : ''}
                  {timeAgo(s.lastSeenAt)}活跃
                </div>
              </div>
              {!s.current ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => revokeOne.mutate(s.id)}
                >
                  登出
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
