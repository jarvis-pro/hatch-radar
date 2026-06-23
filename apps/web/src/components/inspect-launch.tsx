import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Microscope } from 'lucide-react';
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
import { Label } from '@hatch-radar/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hatch-radar/ui/components/select';
import { Switch } from '@hatch-radar/ui/components/switch';
import { toast } from '@hatch-radar/ui/components/sonner';
import { Spinner } from '@hatch-radar/ui/components/spinner';
import { api, ApiError } from '@/api/client';

interface ProviderOptionsResponse {
  providers: { id: number; label: string }[];
  activeProviderId: number | null;
}

/**
 * 「流水线检视」入口：选模型 + 逐节点闸门，发起单条检视任务并跳转检视页。
 * 复用于帖子详情等数据流各处——只需传 postId。
 */
export function InspectLaunchButton({
  postId,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  postId: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm';
  className?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState('');
  const [stepGate, setStepGate] = useState(true);
  const [busy, setBusy] = useState(false);

  const providersQ = useQuery({
    queryKey: ['inspect-providers'],
    queryFn: () => api.get<ProviderOptionsResponse>('/analysis/providers'),
    enabled: open,
  });

  // 拉到模型列表后，默认选中 active（或第一个）
  const providers = providersQ.data?.providers ?? [];
  const resolvedProviderId =
    providerId ||
    (providersQ.data
      ? String(
          providersQ.data.activeProviderId != null &&
            providers.some((p) => p.id === providersQ.data!.activeProviderId)
            ? providersQ.data.activeProviderId
            : (providers[0]?.id ?? ''),
        )
      : '');

  async function launch() {
    if (!resolvedProviderId) {
      return;
    }

    setBusy(true);
    try {
      const { jobId } = await api.post<{ jobId: number }>('/analysis/inspect', {
        postId,
        providerId: Number(resolvedProviderId),
        stepGate,
      });
      setOpen(false);
      navigate(`/inspect/${jobId}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '发起检视失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Microscope className="size-4" />
          流水线检视
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>流水线检视</DialogTitle>
          <DialogDescription>
            只跑这一条，把「原始帖子如何一步步变成洞察」逐节点展开、可暂停可回看。
          </DialogDescription>
        </DialogHeader>

        {providersQ.isError ? (
          <p className="text-sm text-destructive">模型列表加载失败，请重试。</p>
        ) : providers.length === 0 && providersQ.isSuccess ? (
          <p className="text-sm text-muted-foreground">
            未配置可用模型，请先到设置页启用一个模型。
          </p>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="inspect-model">模型</Label>
              <Select value={resolvedProviderId} onValueChange={setProviderId}>
                <SelectTrigger id="inspect-model" className="w-full">
                  <SelectValue placeholder={providersQ.isPending ? '加载中…' : '选择模型'} />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="inspect-gate">逐节点暂停</Label>
                <p className="text-xs text-muted-foreground">
                  每个节点跑完后停在闸门，等你点「继续」。关掉则一口气跑完（仍留完整轨迹）。
                </p>
              </div>
              <Switch id="inspect-gate" checked={stepGate} onCheckedChange={setStepGate} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={() => void launch()} disabled={busy || !resolvedProviderId}>
            {busy ? <Spinner /> : '开始检视'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
