import Link from 'next/link';
import { ShieldX } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@hatch-radar/ui/components/empty';

/** 无权访问占位：服务端权限校验未通过时由页面渲染。 */
export function Forbidden({ hint }: { hint?: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldX />
        </EmptyMedia>
        <EmptyTitle>无权访问</EmptyTitle>
        <EmptyDescription>
          {hint ?? '你的账户没有访问此页面的权限，如需开通请联系管理员。'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="sm">
          <Link href="/">返回洞察</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
