import { Dropdown, Button, Tooltip } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import {
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../hooks/useTheme';
import type { ThemeMode } from '../../store/settingsStore';

const ITEMS: { key: ThemeMode; icon: React.ReactNode; label: string }[] = [
  { key: 'light', icon: <SunOutlined />, label: 'Light' },
  { key: 'dark', icon: <MoonOutlined />, label: 'Dark' },
  { key: 'system', icon: <DesktopOutlined />, label: 'System' },
];

export default function ThemeToggle() {
  const { mode, isDark, setTheme } = useTheme();

  const items: ItemType[] = ITEMS.map((i) => ({
    key: i.key,
    icon: i.icon,
    label: i.label,
  }));

  return (
    <Dropdown
      menu={{
        items,
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => setTheme(key as ThemeMode),
      }}
      placement="bottomRight"
    >
      <Tooltip title="Appearance">
        <Button
          type="text"
          icon={isDark ? <MoonOutlined /> : <SunOutlined />}
          // Sits on the always-dark header, so it keeps a fixed light tint.
          style={{ color: '#94a3b8' }}
          size="small"
        />
      </Tooltip>
    </Dropdown>
  );
}
