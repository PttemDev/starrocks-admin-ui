import { useEffect, useState, useCallback } from 'react';
import { Tabs, Table, Typography, Input, Alert, Space } from 'antd';
import { ControlOutlined, SearchOutlined } from '@ant-design/icons';
import { runQuery } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import AutoRefresh from '../shared/AutoRefresh';

type TabResult = { columns: string[]; rows: Record<string, unknown>[]; error?: string; loading: boolean };

const TABS: { key: string; label: string; sql: string; hint: string }[] = [
  { key: 'variables', label: 'Variables', sql: 'SHOW VARIABLES', hint: 'Session/global system variables (SHOW VARIABLES).' },
  { key: 'config', label: 'FE Config', sql: 'ADMIN SHOW FRONTEND CONFIG', hint: 'Frontend configuration (ADMIN SHOW FRONTEND CONFIG). Requires admin privilege on the cluster.' },
  { key: 'catalogs', label: 'Catalogs', sql: 'SHOW CATALOGS', hint: 'Internal + external catalogs (Hive/Iceberg/JDBC…) registered on the cluster.' },
  { key: 'resource_groups', label: 'Resource Groups', sql: 'SHOW RESOURCE GROUPS ALL', hint: 'Workload isolation / QoS groups (SHOW RESOURCE GROUPS ALL).' },
];

export default function ClusterPage() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const [active, setActive] = useState('variables');
  const [results, setResults] = useState<Record<string, TabResult>>({});
  const [search, setSearch] = useState('');

  const loadTab = useCallback((key: string, force = false) => {
    if (!selectedEnv) return;
    const tab = TABS.find((t) => t.key === key);
    if (!tab) return;
    setResults((prev) => {
      if (!force && prev[key] && !prev[key].error) return prev; // cached
      return { ...prev, [key]: { columns: [], rows: [], loading: true } };
    });
    runQuery(selectedEnv, tab.sql)
      .then((res) => setResults((prev) => ({ ...prev, [key]: { columns: res.columns || [], rows: res.rows || [], loading: false } })))
      .catch((err) => setResults((prev) => ({ ...prev, [key]: { columns: [], rows: [], loading: false, error: err instanceof Error ? err.message : String(err) } })));
  }, [selectedEnv]);

  // (Re)load the active tab when env or tab changes.
  useEffect(() => { setResults({}); }, [selectedEnv]);
  useEffect(() => { loadTab(active); setSearch(''); }, [active, loadTab]);

  if (!selectedEnv) {
    return <Alert message="No Environment Selected" description="Select an environment from the top-right dropdown." type="info" showIcon />;
  }

  const cur = results[active] || { columns: [], rows: [], loading: true };
  const tab = TABS.find((t) => t.key === active)!;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? cur.rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)))
    : cur.rows;

  const columns = cur.columns.map((c) => ({
    title: c,
    dataIndex: c,
    key: c,
    ellipsis: true,
    sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => String(a[c] ?? '').localeCompare(String(b[c] ?? '')),
    render: (v: unknown) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{v === null || v === undefined || v === '' ? <span style={{ color: 'var(--sr-text-faint)' }}>—</span> : String(v)}</span>,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <ControlOutlined style={{ marginRight: 8 }} />
            Cluster
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Read-only view of cluster variables, FE config, catalogs, and resource groups.
          </Typography.Text>
        </div>
        <AutoRefresh onRefresh={() => loadTab(active, true)} loading={cur.loading} />
      </div>

      <div className="sr-card" style={{ padding: '8px 16px 16px' }}>
        <Tabs activeKey={active} onChange={setActive} size="small" items={TABS.map((t) => ({ key: t.key, label: t.label }))} />
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{tab.hint}</Typography.Text>
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--sr-text-muted)' }} />}
              placeholder="Filter…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
          </div>
          {cur.error ? (
            <Alert type="error" showIcon message="Query failed" description={cur.error} style={{ borderRadius: 8 }} />
          ) : (
            <Table
              className="sr-table"
              columns={columns}
              dataSource={filtered.map((r, i) => ({ ...r, _k: i }))}
              rowKey="_k"
              size="small"
              loading={cur.loading}
              pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} rows` }}
              scroll={{ x: 'max-content' }}
            />
          )}
        </Space>
      </div>
    </div>
  );
}
