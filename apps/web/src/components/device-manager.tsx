import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Plus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { DeviceRow, EnrollmentRow } from '@hatch-radar/shared';
import { Alert, AlertDescription } from '@hatch-radar/ui/components/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@hatch-radar/ui/components/alert-dialog';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@hatch-radar/ui/components/dialog';
import { Input } from '@hatch-radar/ui/components/input';
import { Label } from '@hatch-radar/ui/components/label';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { toast } from '@hatch-radar/ui/components/sonner';
import { api, ApiError } from '@/api/client';
import { timeAgo } from '@/lib/format';

const TTL_OPTIONS = [7, 30, 60];

function daysLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000));
}

function errText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** 某用户的设备面板（在账户管理的 Sheet 内）：赋予新设备 / 设备列表强踢 / 待激活取消。 */
export function DeviceManager({
  userId,
  devices,
  enrollments,
}: {
  userId: string;
  devices: DeviceRow[];
  enrollments: EnrollmentRow[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState(30);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kick, setKick] = useState<DeviceRow | null>(null);
  const [pending, setPending] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin'] });

  async function provision(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const { code } = await api.post<{ code: string }>(`/admin/users/${userId}/enrollments`, {
        deviceName: name,
        ttlDays: ttl,
      });
      setName('');
      setCode(code);
      invalidate();
    } catch (err) {
      setError(errText(err, '生成失败'));
    } finally {
      setPending(false);
    }
  }

  async function runKick(): Promise<void> {
    if (!kick) {
      return;
    }

    const id = kick.id;
    setError(null);
    setPending(true);
    try {
      await api.del(`/admin/devices/${id}`);
      setKick(null);
      invalidate();
    } catch (err) {
      setKick(null);
      setError(errText(err, '操作失败'));
    } finally {
      setPending(false);
    }
  }

  async function cancelEnroll(id: string): Promise<void> {
    setError(null);
    setPending(true);
    try {
      await api.del(`/admin/enrollments/${id}`);
      invalidate();
    } catch (err) {
      setError(errText(err, '操作失败'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-5">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 rounded-md border p-3">
        <div className="text-sm font-medium">赋予新设备</div>
        <div className="grid gap-2">
          <Label htmlFor="device-name">设备名</Label>
          <Input
            id="device-name"
            placeholder="如：现场 iPad 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label>离线宽限</Label>
          <div className="flex gap-2">
            {TTL_OPTIONS.map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={ttl === d ? 'default' : 'outline'}
                onClick={() => setTtl(d)}
              >
                {d} 天
              </Button>
            ))}
          </div>
        </div>
        <Button
          type="button"
          className="gap-1"
          disabled={pending || !name.trim()}
          onClick={provision}
        >
          {pending ? <Spinner /> : <Plus className="size-4" />} 生成激活码
        </Button>
      </section>

      <section className="grid gap-2">
        <div className="text-sm font-medium">设备（{devices.length}）</div>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无设备。</p>
        ) : (
          devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate">
                  {d.deviceName}
                  {d.status === 'revoked' ? (
                    <Badge variant="outline" className="ml-2">
                      已踢
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {d.lastSeenAt ? `${timeAgo(d.lastSeenAt)}活跃 · ` : '未联网 · '}
                  {d.status === 'active' ? `${daysLeft(d.expiresAt)} 天后到期` : '已失效'}
                </div>
              </div>
              {d.status === 'active' ? (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => setKick(d)}>
                  强踢
                </Button>
              ) : null}
            </div>
          ))
        )}
      </section>

      {enrollments.length > 0 ? (
        <section className="grid gap-2">
          <div className="text-sm font-medium">待激活（{enrollments.length}）</div>
          {enrollments.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate">{e.deviceName}</div>
                <div className="text-xs text-muted-foreground">
                  激活码 {timeAgo(e.expiresAt)}过期 · 宽限 {e.ttlDays} 天
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => cancelEnroll(e.id)}
              >
                取消
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      <Dialog open={code !== null} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>激活码已生成</DialogTitle>
            <DialogDescription>
              在移动端「激活设备」页输入此码完成激活（15 分钟内有效，仅此一次显示）。
            </DialogDescription>
          </DialogHeader>
          {code ? (
            <div className="flex justify-center py-2">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={code} size={176} />
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-center font-mono text-lg tracking-wider select-all">
              {code}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="复制激活码"
              onClick={() => {
                if (!code) {
                  return;
                }

                void navigator.clipboard.writeText(code);
                toast.success('激活码已复制');
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={kick !== null} onOpenChange={(o) => !o && setKick(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>强踢设备</AlertDialogTitle>
            <AlertDialogDescription>
              将吊销「{kick?.deviceName}」的凭据，该设备下次联网即无法 sync /
              拉取批次。已下载到本地的数据不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} className="gap-2" onClick={runKick}>
              {pending ? <Spinner /> : null}
              强踢
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
