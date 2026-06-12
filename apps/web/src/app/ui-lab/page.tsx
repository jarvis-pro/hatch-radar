import type { Metadata } from 'next';
import { Badge } from '@hatch-radar/ui/components/badge';
import { Button } from '@hatch-radar/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hatch-radar/ui/components/card';
import { Input } from '@hatch-radar/ui/components/input';
import { Separator } from '@hatch-radar/ui/components/separator';
import { Skeleton } from '@hatch-radar/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hatch-radar/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hatch-radar/ui/components/tabs';

/** 页面元数据：内部预览页，禁止搜索引擎索引 */
export const metadata: Metadata = {
  title: 'UI Lab',
  /** robots.index=false：不被搜索引擎收录 */
  robots: { index: false },
};

/** 内部页面：@hatch-radar/ui（shadcn/ui）组件冒烟预览，无导航入口，可随时删除 */
export default function UiLabPage() {
  return (
    <div className="flex flex-col gap-6 py-2">
      <div>
        <h1 className="text-lg font-semibold">UI Lab</h1>
        <p className="text-muted-foreground text-sm">
          @hatch-radar/ui 组件预览（shadcn/ui + Tailwind v4），仅用于开发期自查。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button>主按钮</Button>
        <Button variant="secondary">次要</Button>
        <Button variant="outline">描边</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="destructive">危险</Button>
        <Badge>默认</Badge>
        <Badge variant="secondary">次要</Badge>
        <Badge variant="outline">描边</Badge>
      </div>

      <div className="flex max-w-sm items-center gap-2">
        <Input placeholder="搜索洞察…" />
        <Button variant="outline">搜索</Button>
      </div>

      <Separator />

      <Tabs defaultValue="card" className="w-full">
        <TabsList>
          <TabsTrigger value="card">卡片</TabsTrigger>
          <TabsTrigger value="table">表格</TabsTrigger>
          <TabsTrigger value="skeleton">骨架屏</TabsTrigger>
        </TabsList>
        <TabsContent value="card">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>洞察示例</CardTitle>
              <CardDescription>shadcn/ui 卡片组件，主题变量跟随系统深浅色。</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              独立开发者抱怨现有工具同步延迟高，存在轻量级替代品的机会。
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="table">
          <Table className="max-w-md">
            <TableHeader>
              <TableRow>
                <TableHead>来源</TableHead>
                <TableHead>强度</TableHead>
                <TableHead className="text-right">提及数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>reddit</TableCell>
                <TableCell>high</TableCell>
                <TableCell className="text-right">42</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>hackernews</TableCell>
                <TableCell>medium</TableCell>
                <TableCell className="text-right">17</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="skeleton">
          <div className="flex max-w-md flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
