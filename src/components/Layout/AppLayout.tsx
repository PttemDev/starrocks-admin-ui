import { Menu, Button, Tooltip, Tag } from 'antd';
import {
  ConsoleSqlOutlined,
  DashboardOutlined,
  CloudDownloadOutlined,
  ScheduleOutlined,
  ClockCircleOutlined,
  BlockOutlined,
  ControlOutlined,
  TableOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import EnvSwitcher from './EnvSwitcher';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import { useAuthStore } from '../../store/authStore';

const menuItems = [
  { key: '/query', icon: <ConsoleSqlOutlined />, label: 'Query' },
  { key: '/tables', icon: <TableOutlined />, label: 'Tables' },
  { key: '/ingestion', icon: <CloudDownloadOutlined />, label: 'Ingestion' },
  { key: '/automation', icon: <ClockCircleOutlined />, label: 'Automation' },
  { key: '/materialized-views', icon: <BlockOutlined />, label: 'Mat. Views' },
  { key: '/routines', icon: <ScheduleOutlined />, label: 'Routines' },
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/cluster', icon: <ControlOutlined />, label: 'Cluster' },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const role = useAuthStore((s) => s.role);
  const username = useAuthStore((s) => s.username);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navigation Bar */}
      <header
        style={{
          background: '#0f1729',
          display: 'flex',
          alignItems: 'center',
          height: 48,
          padding: '0 20px',
          gap: 0,
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginRight: 32,
            flexShrink: 0,
          }}
        >
          <Logo size={28} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#f1f5f9',
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}
          >
            StarRocks Manager
          </span>
        </div>

        {/* Nav Menu */}
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{
            background: 'transparent',
            border: 'none',
            flex: 1,
            minWidth: 0,
            lineHeight: '48px',
          }}
        />

        {/* Right side: Env + User + Logout */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <EnvSwitcher />

          <div
            style={{
              width: 1,
              height: 20,
              background: 'rgba(148,163,184,0.25)',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                background: role === 'admin'
                  ? 'linear-gradient(135deg, #6366f1, #818cf8)'
                  : 'linear-gradient(135deg, #64748b, #94a3b8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 11,
              }}
            >
              <UserOutlined />
            </div>
            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
              {username || 'user'}
            </span>
            {role === 'viewer' && (
              <Tag
                style={{
                  margin: 0,
                  borderRadius: 4,
                  fontSize: 10,
                  lineHeight: '18px',
                  padding: '0 6px',
                  background: 'rgba(148,163,184,0.15)',
                  border: '1px solid rgba(148,163,184,0.25)',
                  color: '#94a3b8',
                }}
              >
                View Only
              </Tag>
            )}
          </div>

          <ThemeToggle />

          <Tooltip title="Sign out">
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={logout}
              style={{ color: '#94a3b8' }}
              size="small"
            />
          </Tooltip>
        </div>
      </header>

      {/* Content */}
      <main
        style={{
          flex: 1,
          padding: 20,
          background: 'var(--sr-bg)',
          overflow: 'auto',
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
