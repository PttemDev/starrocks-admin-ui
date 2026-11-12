import { useEffect, useState, useCallback } from 'react';
import { Table, Tooltip, Typography, Spin, Alert, Tag, Space, Badge, Button, Modal, message } from 'antd';
import {
  QuestionCircleOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  InfoCircleOutlined,
  DatabaseOutlined,
  CloudServerOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';
import { fetchNodes, adminExec } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import { getColumnTooltip } from '../../utils/columnTooltips';
import AutoRefresh from '../shared/AutoRefresh';
import type { NodeGroup } from '../../api/types';

/** Columns to show first (important ones) for backends */
const backendPriorityColumns = [
  'Host', 'Alive', 'CpuCores', 'TotalCapacity', 'DataUsedCapacity',
  'AvailCapacity', 'UsedPct', 'TabletNum', 'NumRunningQueries',
  'MemUsedPct', 'CpuUsedPct', 'Version', 'LastHeartbeat', 'ErrMsg',
];

/** Columns to show first for frontends */
const frontendPriorityColumns = [
  'Host', 'Alive', 'Role', 'IsMaster', 'QueryPort', 'HttpPort',
  'ReplayedJournalId', 'Version', 'LastHeartbeat', 'ErrMsg',
];

/** Columns to hide by default (too noisy) */
const hiddenColumns = new Set([
  'BackendId', 'HeartbeatPort', 'BrpcPort', 'StarletPort',
  'SystemDecommissioned', 'Status', 'ClusterId', 'IsHelper',
  'DataTotalCapacity', 'DataUsedPct', 'TrashUsedCapacity',
]);

function sortColumns(keys: string[], priorities: string[]): string[] {
  const prioritySet = new Map(priorities.map((k, i) => [k, i]));
  const sorted = [...keys].filter((k) => !hiddenColumns.has(k));
  sorted.sort((a, b) => {
    const pa = prioritySet.get(a) ?? 999;
    const pb = prioritySet.get(b) ?? 999;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
  return sorted;
}

function renderCellValue(key: string, val: unknown): React.ReactNode {
  const str = String(val ?? '');

  // Alive column
  if (key === 'Alive' || key === 'alive') {
    const isAlive = str.toLowerCase() === 'true';
    return (
      <span className={`sr-status-badge ${isAlive ? 'alive' : 'dead'}`}>
        <span className="status-dot" />
        {isAlive ? 'Alive' : 'Dead'}
      </span>
    );
  }

  // IsMaster
  if (key === 'IsMaster') {
    const isMaster = str.toLowerCase() === 'true';
    return isMaster ? (
      <Tag color="blue" style={{ borderRadius: 4 }}>Leader</Tag>
    ) : (
      <span style={{ color: 'var(--sr-text-muted)' }}>-</span>
    );
  }

  // Role
  if (key === 'Role') {
    const color = str === 'LEADER' ? 'blue' : str === 'FOLLOWER' ? 'green' : 'default';
    return <Tag color={color} style={{ borderRadius: 4 }}>{str}</Tag>;
  }

  // Used percentages - show with color indicator
  if (key.endsWith('Pct') || key.endsWith('UsedPct')) {
    const num = parseFloat(str);
    if (!isNaN(num)) {
      const percent = str.includes('%') ? str : `${num}%`;
      let color = '#10b981'; // green
      if (num > 80) color = '#ef4444'; // red
      else if (num > 60) color = '#f59e0b'; // orange
      return (
        <span style={{ fontWeight: 500, color }}>{percent}</span>
      );
    }
  }

  // Error messages
  if (key === 'ErrMsg') {
    if (!str || str === '' || str === 'null') {
      return <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
    }
    return (
      <Tooltip title={str}>
        <Tag color="red" style={{ borderRadius: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {str.length > 30 ? str.slice(0, 30) + '...' : str}
        </Tag>
      </Tooltip>
    );
  }

  // Empty values
  if (!str || str === 'null' || str === 'undefined') {
    return <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
  }

  return str;
}

function NodeGroupTable({
  group,
  type,
  onRefresh,
}: {
  group: NodeGroup;
  type: 'backend' | 'frontend';
  onRefresh: () => void;
}) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAddFollower = (ip: string, editLogPort: string) => {
    const addr = `${ip}:${editLogPort}`;
    const sql = `ALTER SYSTEM ADD FOLLOWER "${addr}"`;
    Modal.confirm({
      title: 'Add FOLLOWER node?',
      content: (
        <div>
          <p>This will register the node at <strong>{addr}</strong> as a FOLLOWER in the cluster.</p>
          <pre style={{ background: 'var(--sr-neutral-bg)', padding: 8, borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{sql}</pre>
        </div>
      ),
      okText: 'Execute',
      onOk: async () => {
        if (!selectedEnv) return;
        setActionLoading(ip);
        try {
          await adminExec(selectedEnv, sql);
          message.success(`Successfully added FOLLOWER ${addr}`);
          onRefresh();
        } catch (err) {
          message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  const handleReRegister = (ip: string, editLogPort: string) => {
    const addr = `${ip}:${editLogPort}`;
    const dropSql = `ALTER SYSTEM DROP FOLLOWER "${addr}"`;
    const addSql = `ALTER SYSTEM ADD FOLLOWER "${addr}"`;
    Modal.confirm({
      title: 'Drop & Re-add FOLLOWER?',
      icon: <InfoCircleOutlined style={{ color: '#f59e0b' }} />,
      content: (
        <div>
          <p>This node is registered but not responding. This will <strong>drop</strong> and <strong>re-add</strong> it:</p>
          <pre style={{ background: 'var(--sr-neutral-bg)', padding: 8, borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
{`1) ${dropSql}\n2) ${addSql}`}
          </pre>
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--sr-text-secondary)' }}>
            After this, restart the FE process on {ip} with <code>--helper {'{leader_ip}'}:9010</code> so it can rejoin.
          </p>
        </div>
      ),
      okText: 'Drop & Re-add',
      okType: 'danger',
      onOk: async () => {
        if (!selectedEnv) return;
        setActionLoading(ip);
        try {
          await adminExec(selectedEnv, dropSql);
          await adminExec(selectedEnv, addSql);
          message.success(`Successfully re-registered FOLLOWER ${addr}`);
          onRefresh();
        } catch (err) {
          message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  if (group.data.length === 0) {
    return (
      <div className="sr-empty-state">
        <InfoCircleOutlined className="empty-icon" />
        <div className="empty-title">No {type}s found</div>
        <div className="empty-desc">
          No {type} nodes were returned by the cluster. Check your StarRocks deployment.
        </div>
      </div>
    );
  }

  const allKeys = Object.keys(group.data[0]);
  const priorities = type === 'backend' ? backendPriorityColumns : frontendPriorityColumns;
  const sortedKeys = sortColumns(allKeys, priorities);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: any[] = [
    ...sortedKeys.map((key) => {
      const tooltip = getColumnTooltip(key, type);
      return {
        title: tooltip ? (
          <Tooltip title={tooltip}>
            <span className="sr-column-header">
              {key}
              <QuestionCircleOutlined className="header-help" />
            </span>
          </Tooltip>
        ) : (
          key
        ),
        dataIndex: key,
        key,
        ellipsis: true,
        width: key === 'Host' ? 140 : key === 'Alive' ? 90 : undefined,
        render: (val: unknown) => renderCellValue(key, val),
      };
    }),
  ];

  // Add actions column for frontend nodes (admin only)
  if (type === 'frontend' && role === 'admin') {
    columns.push({
      title: 'Actions',
      key: '__actions',
      ellipsis: false,
      width: 120,
      dataIndex: '',
      render: (_: unknown, row: Record<string, unknown>) => {
        const alive = String(row.Alive ?? '').toLowerCase() === 'true';
        const ip = String(row.IP ?? row.Host ?? '');
        const editLogPort = String(row.EditLogPort ?? '9010');

        // Every node in SHOW FRONTENDS is already registered in cluster metadata
        if (alive) return <span style={{ color: 'var(--sr-text-muted)', fontSize: 11 }}>Healthy</span>;

        // Dead → offer drop & re-add
        return (
          <Tooltip title="Node is registered but not responding. Click to drop and re-register it.">
            <Button
              size="small"
              danger
              loading={actionLoading === ip}
              onClick={() => handleReRegister(ip, editLogPort)}
              style={{ borderRadius: 6, fontSize: 11 }}
            >
              Re-register
            </Button>
          </Tooltip>
        );
      },
    });
  }

  return (
    <Table
      className="sr-table"
      columns={columns}
      dataSource={group.data.map((row, i) => ({ ...row, key: i }))}
      size="small"
      scroll={{ x: 'max-content' }}
      pagination={false}
      bordered={false}
    />
  );
}

export default function NodeHealth() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const [nodeGroups, setNodeGroups] = useState<NodeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    if (!selectedEnv) return;
    setLoading(true);
    setError(null);
    fetchNodes(selectedEnv)
      .then(setNodeGroups)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedEnv]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to view node health."
        type="info"
        showIcon
      />
    );
  }

  if (error) {
    return (
      <Alert
        message="Failed to load node data"
        description={error}
        type="error"
        showIcon
      />
    );
  }

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <AutoRefresh onRefresh={loadData} loading={loading} />
        </div>
        {nodeGroups.map((group) => {
          const alive = group.data.filter(
            (n) => String(n.Alive ?? n.alive ?? '').toLowerCase() === 'true',
          ).length;
          const total = group.data.length;
          const icon =
            group.type === 'backend' ? (
              <DatabaseOutlined />
            ) : (
              <CloudServerOutlined />
            );

          return (
            <div key={group.type}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <Typography.Text
                  strong
                  style={{
                    fontSize: 15,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {icon}
                  {group.type === 'backend' ? 'Backend Nodes' : 'Frontend Nodes'}
                </Typography.Text>
                <Space size={8}>
                  <Badge
                    count={`${alive} alive`}
                    style={{
                      backgroundColor: 'var(--sr-ok-bg)',
                      color: 'var(--sr-ok-fg)',
                      boxShadow: 'none',
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  />
                  {total - alive > 0 && (
                    <Badge
                      count={`${total - alive} dead`}
                      style={{
                        backgroundColor: 'var(--sr-err-bg)',
                        color: 'var(--sr-err-fg)',
                        boxShadow: 'none',
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    />
                  )}
                </Space>
                <Tooltip title={
                  group.type === 'backend'
                    ? 'Backend nodes store data and execute query fragments. Each BE manages tablet replicas and participates in distributed query execution.'
                    : 'Frontend nodes handle query parsing, planning, and metadata management. The LEADER FE coordinates writes.'
                }>
                  <QuestionCircleOutlined style={{ color: 'var(--sr-text-muted)', cursor: 'help' }} />
                </Tooltip>
              </div>
              <NodeGroupTable group={group} type={group.type} onRefresh={loadData} />
            </div>
          );
        })}
      </div>
    </Spin>
  );
}
