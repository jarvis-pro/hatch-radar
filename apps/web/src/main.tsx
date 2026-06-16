import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@hatch-radar/ui/globals.css';
import { ThemeProvider } from '@hatch-radar/ui/components/theme-provider';
import { Toaster } from '@hatch-radar/ui/components/sonner';
import { AuthProvider } from '@/auth/auth-context';
import { router } from '@/router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 挂载点');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
