import type { TriageStatus } from '@hatch-radar/shared';
import { Badge } from '@hatch-radar/ui/components/badge';
import { TRIAGE_STATUS_LABELS } from '@/lib/format';

const TRIAGE_VARIANT: Record<TriageStatus, 'default' | 'secondary' | 'outline'> = {
  shortlisted: 'default',
  pending: 'outline',
  archived: 'secondary',
};

/** 人工研判状态徽标（待研判 / 已入选 / 已归档） */
export function TriageStatusBadge({ status }: { status: TriageStatus }) {
  return (
    <Badge
      variant={TRIAGE_VARIANT[status]}
      className={status === 'pending' ? 'text-muted-foreground' : undefined}
    >
      {TRIAGE_STATUS_LABELS[status]}
    </Badge>
  );
}
