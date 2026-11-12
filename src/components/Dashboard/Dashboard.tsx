import { useEffect, useState, useCallback } from 'react';
import { Alert, Row, Col, Tooltip, Spin, Tabs, Typography } from 'antd';
import {
  ClusterOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  HddOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  MonitorOutlined,
} from '@ant-design/icons';
import NodeHealth from './NodeHealth';
import { fetchNodes } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import AutoRefresh from '../shared/AutoRefresh';
import QueriesPanel from '../Queries/QueriesPage';
import type { NodeGroup } from '../../api/types';

function StatCard({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  tooltip,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: string | number;
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip title={tooltip}>
      <div className="sr-stat-card">
        <div
          className="stat-icon"
          style={{ background: iconBg, color: iconColor }}
        >
          {icon}
        </div>
        <div className="stat-content">
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      </div>
    </Tooltip>
  );
}

function parseStorageValue(val: unknown): number {
  const str = String(val ?? '');
  const match = str.match(/([\d.]+)\s*(TB|GB|MB|KB|B)?/i);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return n * (multipliers[unit] || 1);
}

function formatStorageBytes(bytes: number): string {
  if (bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function ClusterOverview() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const [nodeGroups, setNodeGroups] = useState<NodeGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(() => {
    if (!selectedEnv) return;
    setLoading(true);
    fetchNodes(selectedEnv)
      .then(setNodeGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedEnv]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const backends = nodeGroups.find((g) => g.type === 'backend')?.data || [];
  const frontends = nodeGroups.find((g) => g.type === 'frontend')?.data || [];
  const totalNodes = backends.length + frontends.length;
  const aliveBackends = backends.filter(
    (n) => String(n.Alive ?? n.alive ?? '').toLowerCase() === 'true',
  ).length;
  const aliveFrontends = frontends.filter(
    (n) => String(n.Alive ?? n.alive ?? '').toLowerCase() === 'true',
  ).length;
  const aliveNodes = aliveBackends + aliveFrontends;
  const deadNodes = totalNodes - aliveNodes;

  // Compute aggregate storage across all backends
  let totalStorageBytes = 0;
  let usedStorageBytes = 0;
  for (const be of backends) {
    totalStorageBytes += parseStorageValue(be.TotalCapacity ?? be.totalCapacity);
    usedStorageBytes += parseStorageValue(be.DataUsedCapacity ?? be.dataUsedCapacity);
  }
  const usedPct = totalStorageBytes > 0 ? ((usedStorageBytes / totalStorageBytes) * 100).toFixed(1) : '0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Spin spinning={loading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<ClusterOutlined />}
              iconBg="#eef2ff"
              iconColor="#6366f1"
              value={totalNodes}
              label="Total Nodes"
              tooltip="Total number of Backend and Frontend nodes in the cluster"
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<CheckCircleFilled />}
              iconBg="var(--sr-ok-bg)"
              iconColor="#10b981"
              value={aliveNodes}
              label="Alive Nodes"
              tooltip="Nodes currently responding to heartbeats and serving requests"
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<CloseCircleFilled />}
              iconBg={deadNodes > 0 ? 'var(--sr-err-bg)' : 'var(--sr-card-alt)'}
              iconColor={deadNodes > 0 ? '#ef4444' : 'var(--sr-text-muted)'}
              value={deadNodes}
              label="Dead Nodes"
              tooltip="Nodes not responding to heartbeats - may need investigation"
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<HddOutlined />}
              iconBg="var(--sr-info-bg)"
              iconColor="#3b82f6"
              value={totalStorageBytes > 0 ? `${formatStorageBytes(usedStorageBytes)} / ${formatStorageBytes(totalStorageBytes)}` : '-'}
              label={totalStorageBytes > 0 ? `Storage (${usedPct}% used)` : 'Storage'}
              tooltip="Used / Total disk capacity across all Backend nodes"
            />
          </Col>
        </Row>
      </Spin>

      <div className="sr-card" style={{ padding: '16px 24px 24px' }}>
        <NodeHealth />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to view cluster status."
        type="info"
        showIcon
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        <DashboardOutlined style={{ marginRight: 8 }} />
        Dashboard
      </Typography.Title>

      <div className="sr-card" style={{ padding: '12px 16px 16px' }}>
        <Tabs
          defaultActiveKey="cluster"
          items={[
            {
              key: 'cluster',
              label: (
                <span>
                  <DatabaseOutlined style={{ marginRight: 4 }} />
                  Cluster
                </span>
              ),
              children: <ClusterOverview />,
            },
            {
              key: 'queries',
              label: (
                <span>
                  <MonitorOutlined style={{ marginRight: 4 }} />
                  Query Monitor
                </span>
              ),
              children: <QueriesPanel embedded />,
            },
          ]}
        />
      </div>
    </div>
  );
}
