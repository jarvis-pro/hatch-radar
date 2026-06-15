import { createBrowserRouter } from 'react-router-dom';
import { ProtectedLayout } from '@/layout';
import { AccountPage } from '@/pages/account';
import { AccountsPage } from '@/pages/admin-accounts';
import { AuditPage } from '@/pages/admin-audit';
import { AnalyzePage } from '@/pages/analyze';
import { InsightDetailPage } from '@/pages/insight-detail';
import { InsightsPage } from '@/pages/insights';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';
import { PasswordPage } from '@/pages/password';
import { PostDetailPage } from '@/pages/post-detail';
import { PostsPage } from '@/pages/posts';
import { SettingsPage } from '@/pages/settings';

/**
 * 客户端路由（React Router 数据路由，无 SSR）。
 * /login 公开；其余在 ProtectedLayout 下（根守卫：未登录→/login、强制改密→/account/password）。
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <InsightsPage /> },
      { path: 'posts', element: <PostsPage /> },
      { path: 'posts/:id', element: <PostDetailPage /> },
      { path: 'insights/:id', element: <InsightDetailPage /> },
      { path: 'analyze', element: <AnalyzePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'account/password', element: <PasswordPage /> },
      { path: 'admin/accounts', element: <AccountsPage /> },
      { path: 'admin/audit', element: <AuditPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
