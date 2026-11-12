import { useEffect, useState, useCallback } from 'react';
import {
  Table, Tag, Typography, Tooltip, Button, Modal, message, Space, Alert, Popconfirm, Select,
} from 'antd';
import {
  BlockOutlined,
  ReloadOutlined,
  CodeOutlined,
  DeleteOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Editor } from '@monaco-editor/react';
import {
  fetchMaterializedViews,
  refreshMaterializedView,
  dropMaterializedView,
  createMaterializedView,
  fetchDatabases,
} from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import AutoRefresh from '../shared/AutoRefresh';
import { useTheme } from '../../hooks/useTheme';

const MV_TEMPLATE = `CREATE MATERIALIZED VIEW mv_example
DISTRIBUTED BY HASH(id)
REFRESH ASYNC EVERY(INTERVAL 1 DAY)
AS
SELECT id, count(*) AS cnt
FROM source_table
GROUP BY id;`;

const REFRESH_STATE_COLORS: Record<string, string> = {
  SUCCESS: 'success', RUNNING: 'processing', PENDING: 'default', FAILED: 'error', MERGED: 'default', SKIPPED: 'warning',
};
const stateColor = (s: string) => REFRESH_STATE_COLORS[String(s || '').toUpperCase()] || 'default';

function formatNumber(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString() : '-';
}

export default function MaterializedViewsPage() {
  const { isDark } = useTheme();
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const [databases, setDatabases] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDb, setCreateDb] = useState<string>('');
  const [createSql, setCreateSql] = useState(MV_TEMPLATE);
  const [creating, setCreating] = useState(false);

  const [defOpen, setDefOpen] = useState(false);
  const [defMv, setDefMv] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    if (!selectedEnv) { setRows([]); return; }
    setLoading(true);
    fetchMaterializedViews(selectedEnv)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [selectedEnv]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedEnv) return;
    fetchDatabases(selectedEnv).then(setDatabases).catch(() => setDatabases([]));
  }, [selectedEnv]);

  const handleCreate = async () => {
    if (!selectedEnv || !createSql.trim()) return;
    setCreating(true);
    try {
      await createMaterializedView(selectedEnv, createSql.trim(), createDb || undefined);
      message.success('Materialized view created');
      setCreateOpen(false);
      load();
    } catch (err) {
      message.error(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setCreating(false); }
  };

  const handleRefresh = async (db: string, name: string) => {
    if (!selectedEnv) return;
    setActing(name);
    try {
      await refreshMaterializedView(selectedEnv, db, name);
      message.success(`Refresh triggered for "${name}"`);
      load();
    } catch (err) {
      message.error(`Refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setActing(null); }
  };

  const handleDrop = async (db: string, name: string) => {
    if (!selectedEnv) return;
    try {
      await dropMaterializedView(selectedEnv, db, name);
      message.success(`"${name}" dropped`);
      load();
    } catch (err) {
      message.error(`Drop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to manage materialized views."
        type="info"
        showIcon
      />
    );
  }

  const columns = [
    {
      title: 'Materialized View',
      dataIndex: 'MvName',
      key: 'MvName',
      width: 220,
      ellipsis: true,
      render: (v: string) => <Typography.Text strong style={{ fontSize: 12 }}>{v}</Typography.Text>,
    },
    { title: 'Database', dataIndex: 'DbName', key: 'DbName', width: 140, ellipsis: true, render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    {
      title: 'Refresh',
      dataIndex: 'RefreshType',
      key: 'RefreshType',
      width: 110,
      render: (v: string) => <Tag style={{ borderRadius: 4, fontSize: 11 }}>{v || '—'}</Tag>,
    },
    {
      title: 'Active',
      dataIndex: 'IsActive',
      key: 'IsActive',
      width: 90,
      render: (v: unknown, r: Record<string, unknown>) => {
        const active = String(v).toLowerCase() === 'true' || v === true || String(v) === '1';
        return active
          ? <Tag color="success" style={{ borderRadius: 4 }}>active</Tag>
          : <Tooltip title={String(r.InactiveReason || 'inactive')}><Tag color="error" style={{ borderRadius: 4 }}>inactive</Tag></Tooltip>;
      },
    },
    {
      title: 'Last Refresh',
      dataIndex: 'LastRefreshState',
      key: 'LastRefreshState',
      width: 110,
      render: (v: string, r: Record<string, unknown>) => {
        if (!v) return <span style={{ color: 'var(--sr-text-muted)', fontSize: 12 }}>—</span>;
        const tag = <Tag color={stateColor(v)} style={{ borderRadius: 4 }}>{String(v).toUpperCase()}</Tag>;
        return r.LastRefreshError
          ? <Tooltip title={String(r.LastRefreshError)}>{tag}</Tooltip>
          : tag;
      },
    },
    { title: 'Finished', dataIndex: 'LastRefreshFinished', key: 'LastRefreshFinished', width: 160, render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    { title: 'Rows', dataIndex: 'TableRows', key: 'TableRows', width: 110, render: (v: unknown) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{formatNumber(v)}</span> },
    {
      title: '',
      key: 'actions',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, r: Record<string, unknown>) => {
        const db = String(r.DbName || '');
        const name = String(r.MvName || '');
        return (
          <Space size={2}>
            <Tooltip title="View definition (SQL)">
              <Button type="text" size="small" icon={<CodeOutlined />} onClick={() => { setDefMv(r); setDefOpen(true); }} />
            </Tooltip>
            {role === 'admin' && (
              <>
                <Tooltip title="Refresh now (async)">
                  <Button type="text" size="small" icon={<ReloadOutlined />} loading={acting === name} onClick={() => handleRefresh(db, name)} />
                </Tooltip>
                <Popconfirm title="Drop materialized view" description={`Delete "${name}"?`} okText="Drop" okButtonProps={{ danger: true }} onConfirm={() => handleDrop(db, name)}>
                  <Tooltip title="Drop"><Button type="text" danger size="small" icon={<DeleteOutlined />} /></Tooltip>
                </Popconfirm>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <BlockOutlined style={{ marginRight: 8 }} />
            Materialized Views
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Pre-computed query results that StarRocks keeps fresh automatically — they accelerate repeated/aggregated queries.
          </Typography.Text>
        </div>
        <Space>
          <AutoRefresh onRefresh={load} loading={loading} />
          {role === 'admin' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreateSql(MV_TEMPLATE); setCreateDb(''); setCreateOpen(true); }} style={{ borderRadius: 8 }}>
              New MV
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="What is a materialized view?"
        description="An MV stores the result of a SELECT (often a join/aggregation) as a physical table and refreshes it on a schedule or when base tables change. Queries that match the MV are answered from it — much faster. “Refresh now” forces an immediate async rebuild; “inactive” means the MV stopped auto-refreshing (hover for the reason)."
        style={{ borderRadius: 8 }}
      />

      <div className="sr-card" style={{ padding: 16 }}>
        <Table
          className="sr-table"
          columns={columns}
          dataSource={rows.map((r, i) => ({ ...r, key: `${r.DbName}.${r.MvName}:${i}` }))}
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div className="sr-empty-state" style={{ padding: '32px 24px' }}>
                <InboxOutlined className="empty-icon" style={{ fontSize: 36 }} />
                <div className="empty-title">No materialized views</div>
                <div className="empty-desc">Create one with <code>CREATE MATERIALIZED VIEW … REFRESH ASYNC …</code> in the Query console.</div>
              </div>
            ),
          }}
        />
      </div>

      <Modal
        title={<Space><CodeOutlined style={{ color: '#6366f1' }} /><span>Definition — <code>{String(defMv?.MvName || '')}</code></span></Space>}
        open={defOpen}
        onCancel={() => setDefOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setDefOpen(false)}>Close</Button>
            <Button type="primary" icon={<CodeOutlined />} onClick={() => { navigator.clipboard.writeText(String(defMv?.Definition || '')); message.success('Definition copied'); }}>
              Copy SQL
            </Button>
          </Space>
        }
        width={820}
      >
        <pre style={{
          margin: 0, padding: 12, background: 'var(--sr-code-bg)', color: 'var(--sr-code-fg)', borderRadius: 8,
          fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 460, overflow: 'auto',
        }}>
          {String(defMv?.Definition || '(no definition)')}
        </pre>
      </Modal>

      {/* Create MV */}
      <Modal
        title={<Space><BlockOutlined style={{ color: '#6366f1' }} /><span>New Materialized View</span></Space>}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="Create"
        okButtonProps={{ disabled: !createSql.trim() }}
        width={820}
      >
        <Space style={{ marginBottom: 10 }} size={8}>
          <Typography.Text style={{ fontSize: 12 }}>Database (for unqualified table names):</Typography.Text>
          <Select
            value={createDb || undefined}
            onChange={setCreateDb}
            placeholder="(optional)"
            allowClear
            showSearch
            style={{ width: 220 }}
            options={databases.filter((d) => !d.startsWith('_') && d !== 'information_schema' && d !== 'sys').map((d) => ({ value: d, label: d }))}
          />
        </Space>
        <div style={{ height: 320, borderRadius: 4, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <Editor
            language="sql"
            value={createSql}
            onChange={(v) => setCreateSql(v || '')}
            options={{ minimap: { enabled: false }, lineNumbers: 'on', fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true }}
            theme={isDark ? 'vs-dark' : 'vs-light'}
          />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          Async MV. Pick a DB above so unqualified table names resolve. Set <code>replication_num</code> in PROPERTIES if this env has fewer BEs. It refreshes on the interval (or change to <code>REFRESH ASYNC</code> for auto-on-base-change).
        </Typography.Text>
      </Modal>
    </div>
  );
}
