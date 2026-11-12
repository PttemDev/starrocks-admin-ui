import { useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { useAuthStore } from './store/authStore';
import { useTheme } from './hooks/useTheme';
import { buildAntdTheme } from './theme';
import AppLayout from './components/Layout/AppLayout';
import LoginPage from './components/Login/LoginPage';
import QueryConsole from './components/QueryConsole/QueryConsole';
import Dashboard from './components/Dashboard/Dashboard';
import IngestionPage from './components/Ingestion/IngestionPage';
import RoutinesPage from './components/Routines/RoutinesPage';
import TablesPage from './components/Tables/TablesPage';
import AutomationPage from './components/Automation/AutomationPage';
import MaterializedViewsPage from './components/MaterializedViews/MaterializedViewsPage';
import ClusterPage from './components/Cluster/ClusterPage';

/**
 * antd's static APIs (Modal.confirm, message.*, notification.*) render into a
 * detached root that never sees the app's <ConfigProvider>, so they came out
 * light while the app was dark. `holderRender` wraps that root, and this
 * component reads the theme itself — message/notification create their holder
 * once and reuse it, so a captured `isDark` would freeze at the first toast.
 */
function ThemedHolder({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();
  return <ConfigProvider theme={buildAntdTheme(isDark)}>{children}</ConfigProvider>;
}

ConfigProvider.config({
  holderRender: (children) => <ThemedHolder>{children}</ThemedHolder>,
});

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const { isDark } = useTheme();
  const themeConfig = useMemo(() => buildAntdTheme(isDark), [isDark]);

  return (
    <ConfigProvider theme={themeConfig}>
      <BrowserRouter>
        <Routes>
          {isLoggedIn ? (
            <Route path="/" element={<AppLayout />}>
              <Route index element={<Navigate to="/query" replace />} />
              <Route path="query" element={<QueryConsole />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="cluster" element={<ClusterPage />} />
              <Route path="ingestion" element={<IngestionPage />} />
              <Route path="automation" element={<AutomationPage />} />
              <Route path="materialized-views" element={<MaterializedViewsPage />} />
              <Route path="routines" element={<RoutinesPage />} />
              <Route path="tables" element={<TablesPage />} />
              <Route path="*" element={<Navigate to="/query" replace />} />
            </Route>
          ) : (
            <>
              <Route path="*" element={<LoginPage />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
