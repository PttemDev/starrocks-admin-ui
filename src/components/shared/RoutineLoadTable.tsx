import { useCallback, useMemo, useRef, useState } from 'react';
import { Table, Tooltip, Button, Space, Modal, message, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
  QuestionCircleOutlined,
  ExclamationCircleFilled,
  WarningFilled,
  EyeOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { executeRoutineLoadCommand } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import { getColumnTooltip } from '../../utils/columnTooltips';
import {
  type RoutineLoadJob, type RoutineLoadRow,
  ACTIVE_STATES, FINAL_STATES, healthIssue, quoteIdent, toJob,
} from '../../utils/routineLoad';
import RoutineLoadStateTag from './RoutineLoadStateTag';
import RoutineLoadDetailModal, { type DetailTab } from './RoutineLoadDetailModal';

interface Props {
  data: RoutineLoadRow[];
  loading: boolean;
  onRefresh: () => void;
  showDbColumn?: boolean;
}

type Action = 'PAUSE' | 'RESUME' | 'STOP';

const muted = <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;

const header = (key: string, label = key) => {
  const tip = getColumnTooltip(key, 'ingestion');
  return tip ? (
    <Tooltip title={tip}>
      <span className="sr-column-header">{label} <QuestionCircleOutlined className="header-help" /></span>
    </Tooltip>
  ) : label;
};

const fmtTs = (ms: number) => new Date(ms).toLocaleString();

export default function RoutineLoadTable({ data, loading, onRefresh, showDbColumn = true }: Props) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);
  const isAdmin = role === 'admin';
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Detail modal follows the live row by key, so auto-refresh keeps it current.
  // The last seen copy is kept for when the row leaves the list (e.g. a state filter).
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<DetailTab>('overview');
  const lastViewed = useRef<RoutineLoadJob | null>(null);

  // Parse every row's JSON columns once per data change, not once per cell render.
  const jobs = useMemo(() => data.map(toJob), [data]);
  const liveViewJob = viewKey ? jobs.find((j) => j.key === viewKey) ?? null : null;
  if (liveViewJob) lastViewed.current = liveViewJob;
  const viewJob = liveViewJob ?? (viewKey ? lastViewed.current : null);

  const openView = useCallback((j: RoutineLoadJob, tab: DetailTab = 'overview') => {
    lastViewed.current = j;
    setViewTab(tab);
    setViewKey(j.key);
  }, []);

  const doExec = useCallback(async (action: Action, j: RoutineLoadJob) => {
    setActionLoading(`${action}-${j.key}`);
    try {
      await executeRoutineLoadCommand(selectedEnv, `${action} ROUTINE LOAD FOR ${quoteIdent(j.db)}.${quoteIdent(j.name)}`);
      message.success(`${action} executed for "${j.name}"`);
      onRefresh();
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  }, [selectedEnv, onRefresh]);

  const execAction = useCallback((action: Action, j: RoutineLoadJob) => {
    if (!selectedEnv) return;
    if (action !== 'STOP') {
      doExec(action, j);
      return;
    }
    Modal.confirm({
      title: `Stop routine load "${j.name}"?`,
      icon: <ExclamationCircleFilled />,
      content: 'This is permanent — a stopped job cannot be resumed. To change settings (including the broker list), pause it and use Settings instead; to start over, use SQL / Re-create.',
      okText: 'Stop Job',
      okType: 'danger',
      onOk: () => doExec(action, j),
    });
  }, [selectedEnv, doExec]);

  const columns = useMemo<ColumnsType<RoutineLoadJob>>(() => {
    const cols: ColumnsType<RoutineLoadJob> = [
      {
        title: header('Name'),
        key: 'Name',
        fixed: 'left',
        width: 220,
        sorter: (a, b) => a.name.localeCompare(b.name),
        render: (_, j) => {
          const issue = healthIssue(j);
          return (
            <Space size={6}>
              {issue && (
                <Tooltip title={<span style={{ fontSize: 12, wordBreak: 'break-word' }}>{issue}</span>}>
                  <WarningFilled style={{ color: 'var(--sr-warning)', cursor: 'help' }} />
                </Tooltip>
              )}
              <a onClick={() => openView(j)} style={{ fontWeight: 500 }}>{j.name}</a>
            </Space>
          );
        },
      },
      ...(showDbColumn ? [{
        title: header('DbName', 'Database'),
        key: 'DbName',
        sorter: (a: RoutineLoadJob, b: RoutineLoadJob) => a.db.localeCompare(b.db),
        render: (_: unknown, j: RoutineLoadJob) => j.db,
      }] : []),
      { title: header('TableName', 'Table'), key: 'TableName', render: (_, j) => j.table },
      {
        title: header('State'),
        key: 'State',
        width: 120,
        sorter: (a, b) => a.state.localeCompare(b.state),
        render: (_, j) => <RoutineLoadStateTag state={j.state} />,
      },
      {
        title: 'Source',
        key: 'Source',
        render: (_, j) => (j.topic ? (
          <Tooltip title={<span style={{ fontFamily: 'monospace', fontSize: 12 }}>{j.brokers}</span>}>
            <span>{j.topic}</span>
          </Tooltip>
        ) : muted),
      },
      {
        title: header('Lag'),
        key: 'Lag',
        align: 'right',
        sorter: (a, b) => (a.totalLag ?? -1) - (b.totalLag ?? -1),
        render: (_, j) => {
          if (j.totalLag === null) return muted;
          const parts = Object.keys(j.lag).sort((a, b) => Number(a) - Number(b));
          return (
            <Tooltip title={<div style={{ fontSize: 12 }}>{parts.map((p) => <div key={p}>P{p}: {Number(j.lag[p]).toLocaleString()}</div>)}</div>}>
              <span style={{ fontFamily: 'monospace', color: j.totalLag > 0 ? undefined : 'var(--sr-success)' }}>
                {j.totalLag.toLocaleString()}
              </span>
            </Tooltip>
          );
        },
      },
      {
        title: header('TimestampProgress', 'Last message'),
        key: 'TimestampProgress',
        render: (_, j) => (j.earliestTs ? (
          <Tooltip title="Time of the last consumed message on the laggiest partition">
            <span>{fmtTs(j.earliestTs)}</span>
          </Tooltip>
        ) : muted),
      },
      {
        title: 'Loaded / Errors',
        key: 'Statistic',
        align: 'right',
        render: (_, j) => (j.stats.loadedRows === undefined ? muted : (
          <span style={{ fontFamily: 'monospace' }}>
            {j.stats.loadedRows.toLocaleString()}
            {' / '}
            <span style={{ color: (j.stats.errorRows ?? 0) > 0 ? 'var(--sr-danger)' : undefined }}>
              {(j.stats.errorRows ?? 0).toLocaleString()}
            </span>
          </span>
        )),
      },
      { title: header('CurrentTaskNum', 'Tasks'), key: 'CurrentTaskNum', align: 'right', render: (_, j) => String(j.raw.CurrentTaskNum ?? '-') },
      {
        title: header('CreateTime', 'Created'),
        key: 'CreateTime',
        sorter: (a, b) => String(a.raw.CreateTime ?? '').localeCompare(String(b.raw.CreateTime ?? '')),
        render: (_, j) => String(j.raw.CreateTime ?? '') || muted,
      },
      {
        title: header('ReasonOfStateChanged', 'Reason'),
        key: 'ReasonOfStateChanged',
        ellipsis: { showTitle: false },
        width: 220,
        render: (_, j) => (j.reason ? <Tooltip title={j.reason}><span>{j.reason}</span></Tooltip> : muted),
      },
      {
        title: 'Actions',
        key: '__actions',
        width: 150,
        fixed: 'right',
        render: (_, j) => {
          const busy = (a: Action) => actionLoading === `${a}-${j.key}`;
          const final = FINAL_STATES.has(j.state);
          return (
            <Space size={2}>
              <Tooltip title="Details">
                <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openView(j)} style={{ color: 'var(--sr-primary)' }} />
              </Tooltip>
              {isAdmin && !final && (
                <Tooltip title="Settings (broker list, concurrency, offsets…)">
                  <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => openView(j, 'settings')} />
                </Tooltip>
              )}
              {isAdmin && ACTIVE_STATES.has(j.state) && (
                <Tooltip title="Pause">
                  <Button type="text" size="small" icon={<PauseCircleOutlined />} loading={busy('PAUSE')} onClick={() => execAction('PAUSE', j)} style={{ color: 'var(--sr-warning)' }} />
                </Tooltip>
              )}
              {isAdmin && j.state === 'PAUSED' && (
                <Tooltip title="Resume">
                  <Button type="text" size="small" icon={<PlayCircleOutlined />} loading={busy('RESUME')} onClick={() => execAction('RESUME', j)} style={{ color: 'var(--sr-success)' }} />
                </Tooltip>
              )}
              {isAdmin && !final && (
                <Tooltip title="Stop permanently">
                  <Button type="text" size="small" icon={<StopOutlined />} loading={busy('STOP')} onClick={() => execAction('STOP', j)} style={{ color: 'var(--sr-danger)' }} />
                </Tooltip>
              )}
            </Space>
          );
        },
      },
    ];
    return cols;
  }, [showDbColumn, isAdmin, actionLoading, openView, execAction]);

  if (data.length === 0 && !loading) return null;

  return (
    <>
      <Table<RoutineLoadJob>
        className="sr-table"
        columns={columns}
        dataSource={jobs}
        rowKey="key"
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
        loading={loading}
        bordered={false}
        locale={{ emptyText: <Typography.Text type="secondary">Loading…</Typography.Text> }}
      />

      <RoutineLoadDetailModal
        job={viewJob}
        open={!!viewKey}
        initialTab={viewTab}
        env={selectedEnv}
        canEdit={isAdmin}
        onClose={() => setViewKey(null)}
        onRefresh={onRefresh}
      />
    </>
  );
}
