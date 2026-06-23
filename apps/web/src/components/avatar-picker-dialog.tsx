import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CurrentUser } from '@hatch-radar/shared';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@hatch-radar/ui/components/dialog';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { avatarDataUri, randomAvatarSeeds } from '@/lib/avatar';
import { UserAvatar } from './user-avatar';

/** 每批候选头像数量。 */
const BATCH = 12;

/**
 * 换头像弹窗：随机一批候选头像供选择，「换一批」重新生成，保存写入 `PATCH /auth/avatar`。
 * 头像由 seed 确定性生成，保存的是所选 seed（或 null=恢复姓名首字母）。
 */
export function AvatarPickerDialog({ user }: { user: CurrentUser }) {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [seeds, setSeeds] = useState<string[]>(() => randomAvatarSeeds(BATCH));
  const [selected, setSelected] = useState<string | null>(user.avatar);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 打开时把当前头像设为选中态并刷新一批候选；关闭不重置。 */
  function onOpenChange(next: boolean): void {
    setOpen(next);
    if (next) {
      setSelected(user.avatar);
      setSeeds(randomAvatarSeeds(BATCH));
      setError(null);
    }
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.patch('/auth/avatar', { avatar: selected });
      await refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败：服务暂时不可用');
    } finally {
      setPending(false);
    }
  }

  const dirty = selected !== user.avatar;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          更换头像
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>更换头像</DialogTitle>
          <DialogDescription>选一个喜欢的，或「换一批」重新生成。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <UserAvatar
            user={{ name: user.name, avatar: selected }}
            className="size-16 rounded-md"
            fallbackClassName="rounded-md bg-primary/10 text-sm font-medium text-primary"
          />
          <span className="text-sm text-muted-foreground">
            {selected ? '已选择新头像' : '当前使用昵称首字母'}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {seeds.map((seed) => {
            const active = seed === selected;

            return (
              <button
                key={seed}
                type="button"
                onClick={() => setSelected(seed)}
                aria-pressed={active}
                aria-label="选择此头像"
                className={`overflow-hidden rounded-md ring-2 ring-offset-2 ring-offset-background transition ${
                  active ? 'ring-primary' : 'ring-transparent hover:ring-border'
                }`}
              >
                <img src={avatarDataUri(seed)} alt="" className="aspect-square w-full" />
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => setSeeds(randomAvatarSeeds(BATCH))}
          >
            <RefreshCw className="size-4" />
            换一批
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setSelected(null)}
            disabled={selected === null}
          >
            用昵称首字母
          </Button>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || pending} className="gap-2">
            {pending ? <Spinner /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
