import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Space, Tooltip } from 'antd';
import { ReloadOutlined, DownOutlined } from '@ant-design/icons';

const intervals = [
  { key: '0', label: 'Off' },
  { key: '5000', label: '5s' },
  { key: '10000', label: '10s' },
  { key: '30000', label: '30s' },
  { key: '60000', label: '1m' },
];

interface Props {
  onRefresh: () => void;
  loading?: boolean;
}

export default function AutoRefresh({ onRefresh, loading }: Props) {
  const [intervalMs, setIntervalMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (intervalMs > 0) {
      timerRef.current = setInterval(onRefresh, intervalMs);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalMs, onRefresh]);

  const activeLabel = intervals.find((i) => i.key === String(intervalMs))?.label || 'Off';

  return (
    <Space.Compact>
      <Tooltip title="Refresh now">
        <Button
          icon={<ReloadOutlined spin={loading} />}
          onClick={onRefresh}
          style={{ borderRadius: '8px 0 0 8px' }}
        >
          Refresh
        </Button>
      </Tooltip>
      <Dropdown
        menu={{
          items: intervals.map((i) => ({
            key: i.key,
            label: i.label,
          })),
          selectedKeys: [String(intervalMs)],
          onClick: ({ key }) => setIntervalMs(Number(key)),
        }}
        trigger={['click']}
      >
        <Button
          style={{
            borderRadius: '0 8px 8px 0',
            minWidth: 56,
            color: intervalMs > 0 ? '#6366f1' : undefined,
            fontWeight: intervalMs > 0 ? 600 : undefined,
          }}
        >
          {activeLabel} <DownOutlined style={{ fontSize: 10 }} />
        </Button>
      </Dropdown>
    </Space.Compact>
  );
}
