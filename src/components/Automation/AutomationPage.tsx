import { useEffect, useState, useCallback } from 'react';
import {
  Table, Tag, Typography, Tooltip, Button, Modal, message, Space, Alert, Popconfirm, Tabs, Select, InputNumber, Form, Input,
} from 'antd';
import {
  ClockCircleOutlined,
  SearchOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  UnorderedListOutlined,
  DeleteOutlined,
  PlusOutlined,
  InboxOutlined,
  CodeOutlined,
  SettingOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import {
  fetchScheduledTasks,
  fetchTaskRuns,
  triggerScheduledTask,
  dropScheduledTask,
  fetchPipes,
  fetchPipeFiles,
  alterPipe,
  setPipeProperty,
  retryPipe,
  dropPipe,
  fetchDatabases,
} from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import AutoRefresh from '../shared/AutoRefresh';
import BatchLoadWizard from '../Ingestion/BatchLoadWizard';
import TaskDetailModal from '../Scheduler/TaskDetailModal';

type Row = Record<string, unknown> & { _type: 'task' | 'pipe' };

// Task-run states / pipe states share a color scheme.
const STATE_COLORS: Record<string, string> = {
  PENDING: 'default', RUNNING: 'processing', SUCCESS: 'success', FAILED: 'error',
  MERGED: 'default', SKIPPED: 'warning', FINISHED: 'success', SUSPENDED: 'warning', ERROR: 'error',
};
const stateColor = (s: string) => STATE_COLORS[String(s || '').toUpperCase()] || 'default';

// A row's display name (task → TaskName; pipe → PipeName).
function rowName(r: Row): string {
  return String((r._type === 'task' ? r.TaskName : r.PipeName) || '');
}

// A row's effective state (task → last run state; pipe → pipe state).
function rowState(r: Row): string {
  return String(r._type === 'task' ? (r.LastState || '') : (r.State || '')).toUpperCase();
}
// "Active" = in-progress / waiting / paused; "Done" = a terminal outcome.
const ACTIVE_STATES = new Set(['RUNNING', 'PENDING', 'SKIPPED', 'MERGED', 'SUSPENDED', '']);
const rowGroup = (r: Row): 'active' | 'done' => (ACTIVE_STATES.has(rowState(r)) ? 'active' : 'done');

const FILE_STATE_COLORS: Record<string, string> = {
  UNLOADED: 'default', LOADING: 'processing', FINISHED: 'success', ERROR: 'error',
};

function targetFromDefinition(def: string): string {
  const m = String(def || '').match(/INSERT\s+(?:OVERWRITE|INTO)\s+([`\w.]+)/i);
  return m ? m[1].replace(/`/g, '') : '-';
}

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function summarizeLoadStatus(raw: unknown): string {
  if (!raw) return '—';
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const files = o.loadedFiles ?? 0;
    const bytes = o.loadedBytes ?? 0;
    const loading = o.loadingFiles ?? 0;
    return `${files} files · ${fmtBytes(Number(bytes))}${loading ? ` · ${loading} loading` : ''}`;
  } catch {
    return String(raw);
  }
}

export default function AutomationPage() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [stateTab, setStateTab] = useState<'all' | 'active' | 'done'>('all');
  const [nameFilter, setNameFilter] = useState('');

  // Task run-history modal
  const [runsOpen, setRunsOpen] = useState(false);
  const [runsName, setRunsName] = useState('');
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Pipe files modal
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesName, setFilesName] = useState('');
  const [filesDb, setFilesDb] = useState('');
  const [files, setFiles] = useState<Record<string, unknown>[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Pipe edit (properties) modal
  const [editOpen, setEditOpen] = useState(false);
  const [editPipe, setEditPipe] = useState<{ db: string; name: string } | null>(null);
  const [editAutoIngest, setEditAutoIngest] = useState(true);
  const [editPoll, setEditPoll] = useState(300);
  const [editSaving, setEditSaving] = useState(false);

  // Task view/edit modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<Record<string, unknown> | null>(null);

  const loadAll = useCallback(() => {
    if (!selectedEnv) { setRows([]); return; }
    setLoading(true);
    Promise.all([
      fetchScheduledTasks(selectedEnv).catch(() => []),
      fetchPipes(selectedEnv).catch(() => []),
    ])
      .then(([tasks, pipes]) => {
        const merged: Row[] = [
          ...tasks.map((t) => ({ ...t, _type: 'task' as const })),
          ...pipes.map((p) => ({ ...p, _type: 'pipe' as const })),
        ];
        setRows(merged);
      })
      .finally(() => setLoading(false));
  }, [selectedEnv]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!selectedEnv) return;
    fetchDatabases(selectedEnv).then(setDatabases).catch(() => setDatabases([]));
  }, [selectedEnv]);

  const openRuns = (taskName: string) => {
    if (!selectedEnv) return;
    setRunsName(taskName); setRunsOpen(true); setRunsLoading(true); setRuns([]);
    fetchTaskRuns(selectedEnv, taskName)
      .then(setRuns)
      .catch((err) => message.error(`Failed to load runs: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setRunsLoading(false));
  };

  const openFiles = (db: string, pipe: string) => {
    if (!selectedEnv) return;
    setFilesName(pipe); setFilesDb(db); setFilesOpen(true); setFilesLoading(true); setFiles([]);
    fetchPipeFiles(selectedEnv, pipe, db)
      .then(setFiles)
      .catch((err) => message.error(`Failed to load files: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setFilesLoading(false));
  };

  // information_schema.pipes.PROPERTIES holds the pipe's actual settings (auto_ingest,
  // poll_interval, …) — parse them so the edit modal shows the real current values.
  const parsePipeProps = (raw: unknown): Record<string, string> => {
    if (!raw) return {};
    const out: Record<string, string> = {};
    const s = String(raw);
    try {
      const o = JSON.parse(s);
      for (const k of Object.keys(o)) out[k.toLowerCase()] = String(o[k]);
      return out;
    } catch {
      // Not JSON. StarRocks reports pipe PROPERTIES as (single-)quoted key=value pairs,
      // optionally wrapped in parentheses, e.g. ('auto_ingest'='TRUE','poll_interval'='3600').
      // Strip surrounding whitespace, quotes ('/") and parens from each token.
      const strip = (x: string) => x.replace(/^[\s('"]+/, '').replace(/[\s)'"]+$/, '');
      s.split(',').forEach((pair) => {
        const i = pair.indexOf('=');
        if (i > 0) out[strip(pair.slice(0, i)).toLowerCase()] = strip(pair.slice(i + 1));
      });
      return out;
    }
  };

  const openEditPipe = (db: string, name: string, propsRaw: unknown) => {
    const p = parsePipeProps(propsRaw);
    setEditAutoIngest(p.auto_ingest === undefined ? true : String(p.auto_ingest).toLowerCase() === 'true');
    const pi = Number(p.poll_interval);
    setEditPoll(Number.isFinite(pi) && pi > 0 ? pi : 300);
    setEditPipe({ db, name });
    setEditOpen(true);
  };

  const handleSavePipe = async () => {
    if (!selectedEnv || !editPipe) return;
    setEditSaving(true);
    try {
      await setPipeProperty(selectedEnv, editPipe.db, editPipe.name, {
        AUTO_INGEST: editAutoIngest ? 'TRUE' : 'FALSE',
        POLL_INTERVAL: String(editPoll),
      });
      message.success(`"${editPipe.name}" updated`);
      setEditOpen(false);
      loadAll();
    } catch (err) {
      message.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setEditSaving(false); }
  };

  const handleRetry = async (db: string, name: string, file?: string) => {
    if (!selectedEnv) return;
    setActing(name);
    try {
      await retryPipe(selectedEnv, db, name, file);
      message.success(file ? 'File retry triggered' : `"${name}" retry-all triggered`);
      if (filesOpen) openFiles(db, name);
      loadAll();
    } catch (err) {
      message.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setActing(null); }
  };

  const handleTrigger = async (taskName: string) => {
    if (!selectedEnv) return;
    setActing(taskName);
    try {
      await triggerScheduledTask(selectedEnv, taskName);
      message.success(`"${taskName}" triggered`);
    } catch (err) {
      message.error(`Trigger failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setActing(null); }
  };

  const handleAlterPipe = async (db: string, name: string, action: 'suspend' | 'resume') => {
    if (!selectedEnv) return;
    setActing(name);
    try {
      await alterPipe(selectedEnv, db, name, action);
      message.success(`"${name}" ${action}d`);
      loadAll();
    } catch (err) {
      message.error(`${action} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setActing(null); }
  };

  const handleDrop = async (r: Row) => {
    if (!selectedEnv) return;
    const name = String(r._type === 'task' ? r.TaskName : r.PipeName);
    try {
      if (r._type === 'task') await dropScheduledTask(selectedEnv, name);
      else await dropPipe(selectedEnv, String(r.DbName || ''), name);
      message.success(`"${name}" dropped`);
      loadAll();
    } catch (err) {
      message.error(`Drop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to manage automation jobs."
        type="info"
        showIcon
      />
    );
  }

  const activeCount = rows.filter((r) => rowGroup(r) === 'active').length;
  const doneCount = rows.length - activeCount;
  const needle = nameFilter.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (stateTab === 'all' || rowGroup(r) === stateTab) &&
      (!needle || rowName(r).toLowerCase().includes(needle)),
  );

  // State filter options come from what is actually on screen, so the dropdown
  // never offers a state that would filter to nothing.
  const stateOptions = Array.from(
    new Set(filtered.map(rowState).filter(Boolean)),
  ).sort().map((v) => ({ text: v, value: v }));

  const columns = [
    {
      title: 'Type',
      key: 'type',
      width: 80,
      filters: [
        { text: 'TASK', value: 'task' },
        { text: 'PIPE', value: 'pipe' },
      ],
      onFilter: (value: React.Key | boolean, r: Row) => r._type === value,
      render: (_: unknown, r: Row) =>
        r._type === 'task'
          ? <Tag color="geekblue" style={{ borderRadius: 4 }}>TASK</Tag>
          : <Tag color="purple" style={{ borderRadius: 4 }}>PIPE</Tag>,
    },
    {
      title: 'Name',
      key: 'name',
      width: 200,
      ellipsis: true,
      render: (_: unknown, r: Row) => (
        <Typography.Text strong style={{ fontSize: 12 }}>
          {String(r._type === 'task' ? r.TaskName : r.PipeName)}
        </Typography.Text>
      ),
    },
    {
      title: 'Database',
      dataIndex: 'DbName',
      key: 'DbName',
      width: 130,
      ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span>,
    },
    {
      title: 'State',
      key: 'state',
      width: 110,
      filters: stateOptions,
      onFilter: (value: React.Key | boolean, r: Row) => rowState(r) === value,
      render: (_: unknown, r: Row) => {
        const s = String(r._type === 'task' ? (r.LastState || '') : (r.State || ''));
        return s
          ? <Tag color={stateColor(s)} style={{ borderRadius: 4 }}>{s.toUpperCase()}</Tag>
          : <span style={{ color: 'var(--sr-text-muted)', fontSize: 12 }}>—</span>;
      },
    },
    {
      title: 'Schedule / Mode',
      key: 'schedule',
      width: 220,
      ellipsis: true,
      render: (_: unknown, r: Row) => {
        if (r._type === 'task') {
          return r.Schedule
            ? <Tag color="blue" style={{ borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>{String(r.Schedule)}</Tag>
            : <span style={{ color: 'var(--sr-text-muted)' }}>manual</span>;
        }
        const p = parsePipeProps(r.Properties);
        const ai = p.auto_ingest === undefined ? true : String(p.auto_ingest).toLowerCase() === 'true';
        const poll = p.poll_interval || '300';
        return (
          <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11 }}>{String(r.Properties || '(no PROPERTIES)')}</pre>}>
            <Tag color="purple" style={{ borderRadius: 4, fontSize: 11, cursor: 'help' }}>
              {ai ? `auto-ingest · ${poll}s` : 'auto-ingest off'}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Target',
      key: 'target',
      width: 160,
      ellipsis: true,
      render: (_: unknown, r: Row) => (
        <span style={{ fontSize: 12 }}>
          {r._type === 'task' ? targetFromDefinition(String(r.Definition || '')) : String(r.TableName || '—')}
        </span>
      ),
    },
    {
      title: 'Loaded / Last run',
      key: 'activity',
      width: 180,
      render: (_: unknown, r: Row) => (
        <span style={{ fontSize: 12 }}>
          {r._type === 'pipe' ? summarizeLoadStatus(r.LoadStatus) : (String(r.LastRunTime || '') || '—')}
        </span>
      ),
    },
    {
      title: 'Created',
      key: 'created',
      width: 160,
      render: (_: unknown, r: Row) => (
        <span style={{ fontSize: 12 }}>{String(r._type === 'task' ? (r.CreateTime || '') : (r.CreatedTime || '')) || '—'}</span>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 210,
      fixed: 'right' as const,
      render: (_: unknown, r: Row) => {
        const db = String(r.DbName || '');
        if (r._type === 'task') {
          const name = String(r.TaskName);
          return (
            <Space size={2}>
              <Tooltip title="View / edit SQL">
                <Button type="text" size="small" icon={<CodeOutlined />} onClick={() => { setDetailTask(r); setDetailOpen(true); }} />
              </Tooltip>
              <Tooltip title="Run history">
                <Button type="text" size="small" icon={<UnorderedListOutlined />} onClick={() => openRuns(name)} />
              </Tooltip>
              {role === 'admin' && (
                <>
                  <Tooltip title="Run now">
                    <Button type="text" size="small" icon={<PlayCircleOutlined />} loading={acting === name} onClick={() => handleTrigger(name)} />
                  </Tooltip>
                  <Popconfirm title="Drop task" description={`Delete scheduled task "${name}"?`} okText="Drop" okButtonProps={{ danger: true }} onConfirm={() => handleDrop(r)}>
                    <Tooltip title="Drop"><Button type="text" danger size="small" icon={<DeleteOutlined />} /></Tooltip>
                  </Popconfirm>
                </>
              )}
            </Space>
          );
        }
        // pipe
        const name = String(r.PipeName);
        const st = String(r.State || '').toUpperCase();
        return (
          <Space size={2}>
            <Tooltip title="View loaded files">
              <Button type="text" size="small" icon={<UnorderedListOutlined />} onClick={() => openFiles(db, name)} />
            </Tooltip>
            {role === 'admin' && (
              <>
                {/* Only a RUNNING pipe can be suspended; anything else (SUSPENDED/ERROR/
                    FINISHED/unknown) offers Resume so a paused pipe can always be restarted. */}
                {st === 'RUNNING' ? (
                  <Tooltip title="Suspend"><Button type="text" size="small" icon={<PauseCircleOutlined />} loading={acting === name} onClick={() => handleAlterPipe(db, name, 'suspend')} /></Tooltip>
                ) : (
                  <Tooltip title="Resume"><Button type="text" size="small" icon={<PlayCircleOutlined />} loading={acting === name} onClick={() => handleAlterPipe(db, name, 'resume')} /></Tooltip>
                )}
                <Tooltip title="Edit (auto-ingest / poll interval)">
                  <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => openEditPipe(db, name, r.Properties)} />
                </Tooltip>
                <Popconfirm title="Retry errored files" description={`Re-load all errored files of "${name}"?`} okText="Retry all" onConfirm={() => handleRetry(db, name)}>
                  <Tooltip title="Retry errored files (RETRY ALL)"><Button type="text" size="small" icon={<RedoOutlined />} loading={acting === name} /></Tooltip>
                </Popconfirm>
                <Popconfirm title="Drop pipe" description={`Delete pipe "${name}"?`} okText="Drop" okButtonProps={{ danger: true }} onConfirm={() => handleDrop(r)}>
                  <Tooltip title="Drop"><Button type="text" danger size="small" icon={<DeleteOutlined />} /></Tooltip>
                </Popconfirm>
              </>
            )}
          </Space>
        );
      },
    },
  ];

  const runColumns = [
    { title: 'State', dataIndex: 'State', key: 'State', width: 100, render: (v: string) => <Tag color={stateColor(v)} style={{ borderRadius: 4 }}>{String(v).toUpperCase()}</Tag> },
    { title: 'Started', dataIndex: 'CreateTime', key: 'CreateTime', width: 170, render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    { title: 'Finished', dataIndex: 'FinishTime', key: 'FinishTime', width: 170, render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    {
      title: 'Error', dataIndex: 'ErrorMessage', key: 'ErrorMessage', ellipsis: true,
      render: (v: string) => (!v || v === 'NULL') ? <span style={{ color: 'var(--sr-text-muted)' }}>—</span> : <Tooltip title={v}><span style={{ fontSize: 11, color: '#ef4444' }}>{v}</span></Tooltip>,
    },
  ];

  const fileColumns = [
    { title: 'File', dataIndex: 'FileName', key: 'FileName', ellipsis: true, render: (v: string) => <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</span> },
    { title: 'Size', dataIndex: 'FileSize', key: 'FileSize', width: 90, render: (v: unknown) => <span style={{ fontSize: 12 }}>{fmtBytes(Number(v) || 0)}</span> },
    { title: 'State', dataIndex: 'LoadState', key: 'LoadState', width: 100, render: (v: string) => <Tag color={FILE_STATE_COLORS[String(v || '').toUpperCase()] || 'default'} style={{ borderRadius: 4 }}>{String(v || '').toUpperCase()}</Tag> },
    { title: 'Staged', dataIndex: 'StagedTime', key: 'StagedTime', width: 160, render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    { title: 'Finished', dataIndex: 'FinishLoadTime', key: 'FinishLoadTime', width: 160, render: (v: string) => <span style={{ fontSize: 12 }}>{v || '—'}</span> },
    {
      title: 'Error', dataIndex: 'ErrorMsg', key: 'ErrorMsg', ellipsis: true,
      render: (v: string) => (!v || v === 'NULL') ? <span style={{ color: 'var(--sr-text-muted)' }}>—</span> : <Tooltip title={v}><span style={{ fontSize: 11, color: '#ef4444' }}>{v}</span></Tooltip>,
    },
    ...(role === 'admin' ? [{
      title: '', key: '_retry', width: 70,
      render: (_: unknown, f: Record<string, unknown>) =>
        String(f.LoadState || '').toUpperCase() === 'ERROR' ? (
          <Tooltip title="Retry this file">
            <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => handleRetry(filesDb, filesName, String(f.FileName))} />
          </Tooltip>
        ) : null,
    }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <ClockCircleOutlined style={{ marginRight: 8 }} />
            Automation
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            StarRocks-native recurring ingestion — scheduled tasks (cron) and pipes (continuous, deduped). No external scheduler.
          </Typography.Text>
        </div>
        <Space>
          <AutoRefresh onRefresh={loadAll} loading={loading} />
          {role === 'admin' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)} style={{ borderRadius: 8 }}>
              New Job
            </Button>
          )}
        </Space>
      </div>

      {/* Table — grouped by run state */}
      <div className="sr-card" style={{ padding: '8px 16px 16px' }}>
        <Tabs
          activeKey={stateTab}
          onChange={(k) => setStateTab(k as 'all' | 'active' | 'done')}
          size="small"
          items={[
            { key: 'all', label: `All (${rows.length})` },
            { key: 'active', label: `Active · running / skipped (${activeCount})` },
            { key: 'done', label: `Finished · success / failed (${doneCount})` },
          ]}
          tabBarExtraContent={
            <Input
              allowClear
              size="small"
              placeholder="Filter by name…"
              prefix={<SearchOutlined style={{ color: 'var(--sr-text-muted)' }} />}
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              style={{ width: 220 }}
            />
          }
        />
        <Table
          className="sr-table"
          columns={columns}
          dataSource={filtered.map((r, i) => ({ ...r, key: `${r._type}:${r.DbName}:${r._type === 'task' ? r.TaskName : r.PipeName}:${i}` }))}
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: (
              <div className="sr-empty-state" style={{ padding: '32px 24px' }}>
                <InboxOutlined className="empty-icon" style={{ fontSize: 36 }} />
                <div className="empty-title">No automation jobs</div>
                <div className="empty-desc">
                  {role === 'admin'
                    ? 'Create one with “New Job” — pick Scheduled task or Continuous (PIPE) in the wizard.'
                    : 'No scheduled tasks or pipes in this environment.'}
                </div>
              </div>
            ),
          }}
        />
      </div>

      {/* Task run history */}
      <Modal
        title={<Space><UnorderedListOutlined style={{ color: '#6366f1' }} /><span>Run history — <code>{runsName}</code></span></Space>}
        open={runsOpen}
        onCancel={() => setRunsOpen(false)}
        footer={<Button onClick={() => setRunsOpen(false)}>Close</Button>}
        width={820}
      >
        <Table className="sr-table" columns={runColumns} dataSource={runs.map((r, i) => ({ ...r, key: i }))} size="small" loading={runsLoading} pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} locale={{ emptyText: <div style={{ padding: '24px 0', color: 'var(--sr-text-muted)' }}>No runs recorded yet.</div> }} />
      </Modal>

      {/* Pipe files */}
      <Modal
        title={<Space><UnorderedListOutlined style={{ color: '#6366f1' }} /><span>Files — <code>{filesName}</code></span></Space>}
        open={filesOpen}
        onCancel={() => setFilesOpen(false)}
        footer={<Button onClick={() => setFilesOpen(false)}>Close</Button>}
        width={900}
      >
        <Table className="sr-table" columns={fileColumns} dataSource={files.map((f, i) => ({ ...f, key: i }))} size="small" loading={filesLoading} pagination={{ pageSize: 10 }} scroll={{ x: 'max-content' }} locale={{ emptyText: <div style={{ padding: '24px 0', color: 'var(--sr-text-muted)' }}>No files recorded yet.</div> }} />
      </Modal>

      {/* Task view/edit */}
      <TaskDetailModal
        open={detailOpen}
        task={detailTask}
        env={selectedEnv}
        canEdit={role === 'admin'}
        onClose={() => setDetailOpen(false)}
        onSaved={() => { setDetailOpen(false); loadAll(); }}
      />

      {/* Edit pipe properties */}
      <Modal
        title={<Space><SettingOutlined style={{ color: '#6366f1' }} /><span>Edit pipe — <code>{editPipe?.name}</code></span></Space>}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSavePipe}
        confirmLoading={editSaving}
        okText="Apply"
        width={520}
      >
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 8, marginBottom: 12 }}
          message="ALTER PIPE … SET PROPERTY"
          description="Sets these properties on the pipe. Auto-ingest off = stops polling for new files (load only what's there now); on = keep watching the path every poll interval."
        />
        <Form layout="vertical" size="small">
          <Form.Item label="Auto-ingest">
            <Select
              value={editAutoIngest ? 'true' : 'false'}
              onChange={(v) => setEditAutoIngest(v === 'true')}
              style={{ width: 200 }}
              options={[{ value: 'true', label: 'On (continuous)' }, { value: 'false', label: 'Off' }]}
            />
          </Form.Item>
          <Form.Item label="Poll interval (sec)" tooltip="How often to scan the path for new files.">
            <InputNumber value={editPoll} onChange={(v) => setEditPoll(v || 300)} min={10} style={{ width: 200 }} disabled={!editAutoIngest} />
          </Form.Item>
        </Form>
      </Modal>

      {/* New job — unified wizard; the Mode selector decides task vs pipe vs one-time */}
      <BatchLoadWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => { setWizardOpen(false); loadAll(); }}
        databases={databases}
        initialMode="task"
      />
    </div>
  );
}
