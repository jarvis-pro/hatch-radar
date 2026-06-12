import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="notice">
      <h2>页面不存在</h2>
      <p>目标内容可能已随 30 天归档清理，或链接有误。</p>
      <p>
        <Link href="/">← 返回洞察列表</Link>
      </p>
    </div>
  );
}
