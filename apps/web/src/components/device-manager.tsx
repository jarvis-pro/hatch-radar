'use client';

import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
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
import {
  cancelEnrollmentAction,
  createEnrollmentAction,
  revokeDeviceAction,
} from '@/lib/admin/device-actions';
import type { DeviceRow, EnrollmentRow } from '@/lib/admin/device-queries';
import { timeAgo } from '@/lib/format';
import { QRCodeSVG } from 'qrcode.react';

const TTL_OPTIONS = [7, 30, 60];

function daysLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000));
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
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState(30);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kick, setKick] = useState<DeviceRow | null>(null);
  const [pending, start] = useTransition();

  function provision() {
    setError(null);
    start(async () => {
      const res = await createEnrollmentAction(userId, name, ttl);
      if (!res.ok || !res.code) {
        setError(res.error ?? '生成失败');
        return;
      }
      setName('');
      setCode(res.code);
    });
  }

  function runKick() {
    if (!kick) return;
    const id = kick.id;
    start(async () => {
      setError(null);
      const res = await revokeDeviceAction(id);
      setKick(null);
      if (!res.ok) setError(res.error ?? '操作失败');
    });
  }

  function cancelEnroll(id: string) {
    start(async () => {
      setError(null);
      const res = await cancelEnrollmentAction(id);
      if (!res.ok) setError(res.error ?? '操作失败');
    });
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
          <div className="rounded bg-muted px-3 py-2 text-center font-mono text-lg tracking-wider select-all">
            {code}
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
