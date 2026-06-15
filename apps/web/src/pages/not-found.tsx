import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@hatch-radar/ui/components/empty';

/** 客户端 404：未匹配路由时渲染。 */
export function NotFoundPage() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle>页面不存在</EmptyTitle>
        <EmptyDescription>目标内容可能已随 30 天归档清理，或链接有误。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to="/">返回洞察列表</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
