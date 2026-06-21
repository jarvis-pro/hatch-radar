import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedLayout } from '@/layout';
import { PermissionsPage } from '@/pages/account-permissions';
import { ProfilePage } from '@/pages/account-profile';
import { SecurityPage } from '@/pages/account-security';
import { SessionsPage } from '@/pages/account-sessions';
import { AccountsPage } from '@/pages/admin-accounts';
import { AuditPage } from '@/pages/admin-audit';
import { AnalyzePage } from '@/pages/analyze';
import { DashboardPage } from '@/pages/dashboard';
import { InspectPage } from '@/pages/inspect';
import { LoginPage } from '@/pages/login';
import { NotFoundPage } from '@/pages/not-found';
import { PasswordPage } from '@/pages/password';
import { SettingsPage } from '@/pages/settings';
import { BlueprintsPage } from '@/radar-lab/blueprints';
import { ControlRoomPage } from '@/radar-lab/control-room';
import { HarvestPage } from '@/radar-lab/harvest';
import { RadarInsightDetailPage } from '@/radar-lab/insight-detail';
import { LibraryPage } from '@/radar-lab/library';
import { PostsPage as RadarPostsPage } from '@/radar-lab/posts';
import { RequestGatePage } from '@/radar-lab/request-gate';
import { RadarRunDetailPage } from '@/radar-lab/run-detail';
import { RadarRunsPage } from '@/radar-lab/runs';

/**
 * 客户端路由（React Router 数据路由，无 SSR）。
 * /login 公开；其余在 ProtectedLayout 下（根守卫：未登录→/login、强制改密→/account/password）。
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'analyze', element: <AnalyzePage /> },
      // 雷达指挥室（radar-lab，全新 mock 闭环原型）
      { path: 'radar', element: <ControlRoomPage /> },
      { path: 'radar/blueprints', element: <BlueprintsPage /> },
      { path: 'radar/runs/:runId', element: <RadarRunDetailPage /> },
      { path: 'radar/requests', element: <RequestGatePage /> },
      { path: 'radar/insights', element: <HarvestPage /> },
      { path: 'radar/insights/:id', element: <RadarInsightDetailPage /> },
      { path: 'radar/posts', element: <LibraryPage /> },
      { path: 'radar/posts/:id', element: <RadarPostsPage /> },
      { path: 'radar/processes/:id/runs', element: <RadarRunsPage /> },
      { path: 'inspect/:jobId', element: <InspectPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'account', element: <Navigate to="/account/profile" replace /> },
      { path: 'account/profile', element: <ProfilePage /> },
      { path: 'account/security', element: <SecurityPage /> },
      { path: 'account/sessions', element: <SessionsPage /> },
      { path: 'account/permissions', element: <PermissionsPage /> },
      { path: 'account/password', element: <PasswordPage /> },
      { path: 'admin/accounts', element: <AccountsPage /> },
      { path: 'admin/audit', element: <AuditPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
