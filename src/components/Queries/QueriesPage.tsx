import { useEffect, useState, useCallback } from 'react';
import {
  Tabs, Table, Alert, Typography, Tag, Tooltip, Button,
  Space, Modal, message, Input,
} from 'antd';
import {
  MonitorOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  StopOutlined,
  SearchOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { fetchCurrentQueries, fetchSlowQueries, killQuery } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import AutoRefresh from '../shared/AutoRefresh';

function formatBytes(bytes: number | null | string): string {
  const n = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  if (n == null || isNaN(n) || n === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = n;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(val: unknown): string {
  const str = String(val ?? '');
  if (!str || str === '0' || str === 'null') return '-';
  // Could be "1.23s", "5m3s", or plain number (seconds)
  const n = parseFloat(str);
  if (isNaN(n)) return str; // already formatted
  if (n < 0.001) return '-';
  if (n < 1) return `${(n * 1000).toFixed(0)}ms`;
  if (n < 60) return `${n.toFixed(1)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

function truncateSql(sql: string, max = 120): string {
  if (!sql) return '-';
  const clean = sql.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max) + '...';
}

function durationColor(val: unknown): string {
  const str = String(val ?? '0');
  const n = parseFloat(str);
  if (isNaN(n)) return 'var(--sr-text-secondary)';
  if (n > 60) return '#ef4444';
  if (n > 10) return '#f59e0b';
  return 'var(--sr-text-secondary)';
}

function RunningQueries() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const loadData = useCallback(() => {
    if (!selectedEnv) return;
    setLoading(true);
    setError(null);
    fetchCurrentQueries(selectedEnv)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedEnv]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleKill = (connId: string) => {
    Modal.confirm({
      title: 'Kill Query',
      icon: <ExclamationCircleOutlined style={{ color: '#ef4444' }} />,
      content: `Are you sure you want to kill connection ${connId}?`,
      okText: 'Kill',
      okType: 'danger',
      onOk: async () => {
        if (!selectedEnv) return;
        try {
          await killQuery(selectedEnv, connId);
          message.success(`Connection ${connId} killed`);
          loadData();
        } catch (err) {
          message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });
  };

  const filtered = filter
    ? data.filter((row) => {
        const q = filter.toLowerCase();
        return Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
      })
    : data;

  // Detect column names dynamically (SHOW PROC vs SHOW PROCESSLIST have different columns)
  const hasQueryId = data.length > 0 && 'QueryId' in data[0];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: any[] = hasQueryId
    ? [
        // SHOW PROC "/current_queries" columns
        {
          title: 'Query ID',
          dataIndex: 'QueryId',
          key: 'QueryId',
          width: 130,
          ellipsis: true,
          render: (v: unknown) => (
            <Tooltip title={String(v ?? '')}>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{String(v ?? '').slice(0, 12)}...</span>
            </Tooltip>
          ),
        },
        { title: 'User', dataIndex: 'User', key: 'User', width: 80 },
        {
          title: 'Database',
          dataIndex: 'Database',
          key: 'Database',
          width: 140,
          render: (v: unknown) => String(v ?? '') || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
        },
        {
          title: 'Exec Time',
          dataIndex: 'ExecTime',
          key: 'ExecTime',
          width: 100,
          render: (v: unknown) => (
            <span style={{ fontFamily: 'monospace', fontWeight: 500, color: durationColor(v) }}>
              {String(v ?? '-')}
            </span>
          ),
        },
        {
          title: 'CPU Time',
          dataIndex: 'CPUTime',
          key: 'CPUTime',
          width: 100,
          render: (v: unknown) => <span style={{ fontFamily: 'monospace' }}>{String(v ?? '-')}</span>,
        },
        {
          title: 'Scan Rows',
          dataIndex: 'ScanRows',
          key: 'ScanRows',
          width: 100,
          render: (v: unknown) => {
            const n = Number(v ?? 0);
            return <span style={{ fontFamily: 'monospace' }}>{n > 0 ? n.toLocaleString() : '-'}</span>;
          },
        },
        {
          title: 'Scan Bytes',
          dataIndex: 'ScanBytes',
          key: 'ScanBytes',
          width: 100,
          render: (v: unknown) => formatBytes(v as string),
        },
        {
          title: 'Memory',
          dataIndex: 'MemoryUsage',
          key: 'MemoryUsage',
          width: 100,
          render: (v: unknown) => formatBytes(v as string),
        },
        {
          title: 'Progress',
          dataIndex: 'ExecProgress',
          key: 'ExecProgress',
          width: 90,
          render: (v: unknown) => {
            const str = String(v ?? '');
            return str && str !== '0%' ? (
              <Tag color="blue" style={{ borderRadius: 4 }}>{str}</Tag>
            ) : <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
          },
        },
        {
          title: 'State',
          dataIndex: 'ExecState',
          key: 'ExecState',
          width: 100,
          render: (v: unknown) => {
            const state = String(v ?? '');
            const color = state === 'RUNNING' ? 'blue' : state === 'FINISHED' ? 'green' : 'default';
            return state ? <Tag color={color} style={{ borderRadius: 4 }}>{state}</Tag> : '-';
          },
        },
        { title: 'Warehouse', dataIndex: 'Warehouse', key: 'Warehouse', width: 120, ellipsis: true },
        { title: 'Start Time', dataIndex: 'StartTime', key: 'StartTime', width: 170, render: (v: unknown) => <span style={{ fontSize: 12 }}>{String(v ?? '-')}</span> },
      ]
    : [
        // SHOW PROCESSLIST columns (fallback)
        {
          title: 'ID',
          dataIndex: 'Id',
          key: 'Id',
          width: 80,
          render: (v: unknown) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(v ?? '')}</span>,
        },
        { title: 'User', dataIndex: 'User', key: 'User', width: 100 },
        {
          title: 'Database',
          dataIndex: 'db',
          key: 'db',
          width: 140,
          render: (v: unknown) => String(v ?? '') || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
        },
        {
          title: 'Command',
          dataIndex: 'Command',
          key: 'Command',
          width: 100,
          render: (v: unknown) => {
            const cmd = String(v ?? '');
            const color = cmd === 'Query' ? 'blue' : cmd === 'Sleep' ? 'default' : 'green';
            return <Tag color={color} style={{ borderRadius: 4 }}>{cmd}</Tag>;
          },
        },
        {
          title: 'Time (s)',
          dataIndex: 'Time',
          key: 'Time',
          width: 90,
          render: (v: unknown) => {
            const n = Number(v ?? 0);
            return <span style={{ fontFamily: 'monospace', fontWeight: 500, color: durationColor(v) }}>{n}s</span>;
          },
        },
        { title: 'State', dataIndex: 'State', key: 'State', width: 140, ellipsis: true },
        {
          title: 'Query',
          dataIndex: 'Info',
          key: 'Info',
          ellipsis: true,
          render: (v: unknown) => {
            const sql = String(v ?? '');
            if (!sql) return <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
            return (
              <Tooltip title={<pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }}>{sql}</pre>}>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{truncateSql(sql)}</span>
              </Tooltip>
            );
          },
        },
      ];

  // Add kill action for admin
  if (role === 'admin') {
    columns.push({
      title: '',
      key: '__actions',
      width: 60,
      render: (_: unknown, row: Record<string, unknown>) => {
        const connId = String(row.ConnectionId ?? row.Id ?? '');
        if (!connId) return null;
        return (
          <Tooltip title="Kill this query">
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() => handleKill(connId)}
              style={{ borderRadius: 6 }}
            />
          </Tooltip>
        );
      },
    });
  }

  if (error) {
    return <Alert message="Failed to load running queries" description={error} type="error" showIcon />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--sr-text-faint)' }} />}
          placeholder="Filter by query, database, or user..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          allowClear
          style={{ width: 320, borderRadius: 8 }}
        />
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {filtered.length} quer{filtered.length !== 1 ? 'ies' : 'y'}
          </Typography.Text>
          <AutoRefresh onRefresh={loadData} loading={loading} />
        </Space>
      </div>
      <Table
        className="sr-table"
        columns={columns}
        dataSource={filtered.map((row, i) => ({ ...row, key: i }))}
        size="small"
        loading={loading}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}

function SlowQueryLog() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const loadData = useCallback(() => {
    if (!selectedEnv) return;
    setLoading(true);
    setError(null);
    fetchSlowQueries(selectedEnv, 200)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedEnv]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (error) {
    return <Alert message="Failed to load slow queries" description={error} type="error" showIcon />;
  }

  // No slow query data source available
  if (!loading && data.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <AutoRefresh onRefresh={loadData} loading={loading} />
        </div>
        <div className="sr-empty-state" style={{ padding: '48px 24px' }}>
          <InfoCircleOutlined className="empty-icon" style={{ fontSize: 40 }} />
          <div className="empty-title">No Slow Query Data</div>
          <div className="empty-desc">
            Slow query logging is not available on this cluster. To enable it, install the
            StarRocks Audit Plugin or upgrade to a version with <code>information_schema.slow_query</code> support.
          </div>
        </div>
      </div>
    );
  }

  // Dynamic columns based on whatever the backend returns
  const allKeys = data.length > 0 ? Object.keys(data[0]) : [];
  const filtered = filter
    ? data.filter((row) => {
        const q = filter.toLowerCase();
        return Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
      })
    : data;

  const columns = allKeys.map((key) => ({
    title: key,
    dataIndex: key,
    key,
    ellipsis: true,
    width: key.toLowerCase().includes('stmt') || key.toLowerCase().includes('query') ? undefined : 130,
    render: (v: unknown) => {
      const str = String(v ?? '');
      if (!str || str === 'null') return <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
      if (key.toLowerCase().includes('bytes')) return formatBytes(str);
      if (key.toLowerCase().includes('time') && !key.toLowerCase().includes('start')) {
        return <span style={{ fontFamily: 'monospace', fontWeight: 500, color: durationColor(str) }}>{formatDuration(str)}</span>;
      }
      if (key.toLowerCase().includes('rows')) {
        const n = Number(str);
        if (!isNaN(n)) return <span style={{ fontFamily: 'monospace' }}>{n.toLocaleString()}</span>;
      }
      if (key.toLowerCase().includes('stmt') || key.toLowerCase().includes('query')) {
        return (
          <Tooltip title={<pre style={{ margin: 0, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }}>{str}</pre>}>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{truncateSql(str, 80)}</span>
          </Tooltip>
        );
      }
      return str;
    },
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--sr-text-faint)' }} />}
          placeholder="Filter by query, database, or user..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          allowClear
          style={{ width: 320, borderRadius: 8 }}
        />
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {filtered.length} slow quer{filtered.length !== 1 ? 'ies' : 'y'}
          </Typography.Text>
          <AutoRefresh onRefresh={loadData} loading={loading} />
        </Space>
      </div>
      <Table
        className="sr-table"
        columns={columns}
        dataSource={filtered.map((row, i) => ({ ...row, key: i }))}
        size="small"
        loading={loading}
        pagination={{ pageSize: 50, showSizeChanger: true }}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}

export default function QueriesPage({ embedded }: { embedded?: boolean }) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to monitor queries."
        type="info"
        showIcon
      />
    );
  }

  const tabs = (
    <Tabs
          defaultActiveKey="running"
          items={[
            {
              key: 'running',
              label: (
                <span>
                  <ThunderboltOutlined style={{ marginRight: 4 }} />
                  Running Queries
                </span>
              ),
              children: <RunningQueries />,
            },
            {
              key: 'slow',
              label: (
                <span>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />
                  Slow Query Log
                </span>
              ),
              children: <SlowQueryLog />,
            },
          ]}
        />
  );

  if (embedded) return tabs;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          <MonitorOutlined style={{ marginRight: 8 }} />
          Query Monitor
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          View running queries, kill long-running queries, and browse the slow query log.
        </Typography.Text>
      </div>
      <div className="sr-card" style={{ padding: '12px 16px 16px' }}>
        {tabs}
      </div>
    </div>
  );
}
