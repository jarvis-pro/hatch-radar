import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import {
  INSPECT_STEP_LABELS,
  type AiCallOutput,
  type ContextOutput,
  type FetchOutput,
  type InspectStepName,
  type InspectStepView,
  type NormalizeOutput,
  type PersistOutput,
  type ResolveOutput,
} from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import { Spinner } from '@hatch-radar/ui/components/spinner';

/** 节点状态 → 徽章。 */
function StatusBadge({ status }: { status: string }) {
  const meta: Record<
    string,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    pending: { label: '待执行', variant: 'outline' },
    running: { label: '运行中', variant: 'default' },
    done: { label: '完成', variant: 'secondary' },
    failed: { label: '失败', variant: 'destructive' },
    skipped: { label: '跳过', variant: 'outline' },
  };
  const m = meta[status] ?? meta.pending;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

/** 键值行。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** 等宽代码块（长文本可滚动）。 */
function CodeBlock({ text, label }: { text: string; label?: string }) {
  return (
    <div className="space-y-1">
      {label ? <p className="text-xs font-medium text-muted-foreground">{label}</p> : null}
      <div className="max-h-96 overflow-auto rounded-md border bg-muted/30">
        <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed">
          {text}
        </pre>
      </div>
    </div>
  );
}

/** 可折叠区块（用于完整 system prompt 等）。 */
function Foldable({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen((o) => !o)}>
        <ChevronDown className={`size-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </Button>
      {open ? children : null}
    </div>
  );
}

/** 把 ai_call 的原始输出（JSON 文本 / structured_output 对象）格式化展示。 */
function rawText(raw: string | object): string {
  if (typeof raw === 'string') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }
  return JSON.stringify(raw, null, 2);
}

function ResolvePanel({ o }: { o: ResolveOutput }) {
  return (
    <div className="divide-y">
      <Field label="模型">{o.label}</Field>
      <Field label="模型 ID">
        <span className="font-mono text-xs">{o.model}</span>
      </Field>
      <Field label="provider">{o.providerKind}</Field>
      <Field label="可用 Key">
        {o.providerKind === 'claude_cli' ? '订阅模式（无 Key 池）' : `${o.usableKeyCount} 把`}
      </Field>
    </div>
  );
}

function FetchPanel({ o }: { o: FetchOutput }) {
  return (
    <div className="divide-y">
      <Field label="标题">{o.title}</Field>
      <Field label="正文字符">{o.selftextChars.toLocaleString()}</Field>
      <Field label="评论">
        本地已抓 {o.commentCount} 条
        {o.numComments > o.commentCount ? ` / 来源标称 ${o.numComments} 条` : ''}
      </Field>
      <Field label="楼层深度">{o.maxDepth}</Field>
    </div>
  );
}

function ContextPanel({ o }: { o: ContextOutput }) {
  return (
    <div className="space-y-3">
      <div className="divide-y">
        <Field label="上下文字符">{o.chars.toLocaleString()}</Field>
        <Field label="估算 token">≈ {o.estimatedTokens.toLocaleString()}</Field>
      </div>
      <Foldable title="System Prompt">
        <CodeBlock text={o.systemPrompt} />
      </Foldable>
      <CodeBlock text={o.contextText} label="发送给模型的完整上下文（user）" />
    </div>
  );
}

function AiCallPanel({ o }: { o: AiCallOutput }) {
  return (
    <div className="space-y-3">
      <div className="divide-y">
        <Field label="使用 Key">
          {o.keyId == null ? '订阅模式（无 Key）' : `#${o.keyId}`}
          {o.keySwitched ? (
            <span className="ml-2 text-xs text-amber-600">（发生过故障转移）</span>
          ) : null}
        </Field>
        {o.usage ? (
          <Field label="token 用量">
            <span className="tabular-nums">
              输入 {o.usage.inputTokens.toLocaleString()} · 输出{' '}
              {o.usage.outputTokens.toLocaleString()}
              {o.usage.cacheReadTokens
                ? ` · 缓存命中 ${o.usage.cacheReadTokens.toLocaleString()}`
                : ''}
            </span>
          </Field>
        ) : null}
      </div>
      <CodeBlock text={rawText(o.raw)} label="AI 原始响应" />
    </div>
  );
}

function NormalizePanel({ o }: { o: NormalizeOutput }) {
  const { insight } = o;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>痛点 {insight.pain_points.length}</span>
        <span>·</span>
        <span>机会 {insight.opportunities.length}</span>
        <span>·</span>
        <span>标签 {insight.tags.length}</span>
        {o.droppedPainPoints + o.droppedOpportunities > 0 ? (
          <span className="text-amber-600">
            · 归一化丢弃 {o.droppedPainPoints + o.droppedOpportunities} 条非法
          </span>
        ) : null}
      </div>

      {insight.pain_points.length === 0 && insight.opportunities.length === 0 ? (
        <p className="text-muted-foreground">无信号（痛点 / 机会均空）。</p>
      ) : null}

      {insight.pain_points.map((p, i) => (
        <div key={i} className="rounded-md border p-3">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="outline">{p.intensity}</Badge>
            <span className="font-medium">{p.description}</span>
          </div>
          {p.evidence ? <p className="text-xs text-muted-foreground">「{p.evidence}」</p> : null}
        </div>
      ))}

      {insight.opportunities.map((op, i) => (
        <div key={i} className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="font-medium">{op.title}</p>
          <p className="text-xs text-muted-foreground">{op.description}</p>
          {op.target_user ? (
            <p className="mt-1 text-xs text-muted-foreground">目标用户：{op.target_user}</p>
          ) : null}
        </div>
      ))}

      {insight.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {insight.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PersistPanel({ o, postId }: { o: PersistOutput; postId: string }) {
  return (
    <div className="space-y-3">
      <div className="divide-y">
        <Field label="结果">
          {o.saved ? (
            <Badge variant="secondary">已落库</Badge>
          ) : (
            <Badge variant="outline">无信号，未落库</Badge>
          )}
        </Field>
        <Field label="落库内容">
          痛点 {o.painPointCount} · 机会 {o.opportunityCount}
        </Field>
      </div>
      {o.saved ? (
        <Button asChild variant="outline" size="sm">
          <Link to={`/radar/posts/${postId}`}>查看帖子与洞察 →</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** 节点产物面板：按节点名渲染对应产物；未执行 / 运行中 / 失败各有占位。 */
export function NodePanel({ step, postId }: { step: InspectStepView; postId: string }) {
  const label = INSPECT_STEP_LABELS[step.name as InspectStepName] ?? step.name;

  function body() {
    if (step.status === 'pending') {
      return <p className="text-sm text-muted-foreground">尚未执行。</p>;
    }
    if (step.status === 'running') {
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> 执行中…
        </p>
      );
    }
    if (step.status === 'failed') {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {step.error ?? '节点执行失败'}
        </div>
      );
    }
    // done：按节点类型渲染产物
    const out = step.output;
    if (out == null) {
      return <p className="text-sm text-muted-foreground">无产物。</p>;
    }
    switch (step.name as InspectStepName) {
      case 'resolve':
        return <ResolvePanel o={out as ResolveOutput} />;
      case 'fetch':
        return <FetchPanel o={out as FetchOutput} />;
      case 'context':
        return <ContextPanel o={out as ContextOutput} />;
      case 'ai_call':
        return <AiCallPanel o={out as AiCallOutput} />;
      case 'normalize':
        return <NormalizePanel o={out as NormalizeOutput} />;
      case 'persist':
        return <PersistPanel o={out as PersistOutput} postId={postId} />;
      default:
        return <CodeBlock text={JSON.stringify(out, null, 2)} />;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          节点 {step.seq + 1}：{label}
        </h2>
        <StatusBadge status={step.status} />
      </div>
      {body()}
    </div>
  );
}
