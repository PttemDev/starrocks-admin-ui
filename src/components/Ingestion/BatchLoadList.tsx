import { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Typography, Tooltip, Button, Modal, message, Space, Progress } from 'antd';
import {
  CloseCircleOutlined,
  InfoCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { fetchBatchLoadJobs, cancelBatchLoad } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import AutoRefresh from '../shared/AutoRefresh';

interface Props {
  database: string;
  stateFilter?: string[];
}

const STATE_COLORS: Record<string, string> = {
  PENDING: 'default',
  PREPARED: 'processing',
  ETL: 'processing',
  LOADING: 'processing',
  COMMITTED: 'processing',
  FINISHED: 'success',
  CANCELLED: 'warning',
  UNKNOWN: 'default',
};

function getStateColor(state: string): string {
  return STATE_COLORS[state] || 'default';
}

function parseProgress(progress: unknown): number | null {
  if (!progress) return null;
  const str = String(progress);
  // Format: "ETL:100%; LOAD:45%" — extract LOAD percentage
  const loadMatch = str.match(/LOAD:(\d+)%/);
  if (loadMatch) return parseInt(loadMatch[1], 10);
  const etlMatch = str.match(/ETL:(\d+)%/);
  if (etlMatch) return parseInt(etlMatch[1], 10);
  return null;
}

export default function BatchLoadList({ database, stateFilter }: Props) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const isAllDbs = database === '__all__';

  const loadData = useCallback(() => {
    if (!selectedEnv || (!database && !isAllDbs)) {
      setData([]);
      return;
    }
    setLoading(true);
    fetchBatchLoadJobs(selectedEnv, isAllDbs ? undefined : database)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [selectedEnv, database, isAllDbs]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCancel = (label: string, dbName: string) => {
    if (!selectedEnv || !dbName) return;
    Modal.confirm({
      title: 'Cancel Load Job',
      content: `Cancel load job "${label}"?`,
      okText: 'Cancel Job',
      okType: 'danger',
      onOk: async () => {
        try {
          await cancelBatchLoad(selectedEnv, dbName, label);
          message.success('Load job cancelled');
          loadData();
        } catch (err) {
          message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });
  };

  const filteredData = stateFilter && stateFilter.length > 0
    ? data.filter((d) => stateFilter.includes(String(d.State || '').toUpperCase()))
    : data;

  const columns = [
    ...(isAllDbs ? [{
      title: 'Database',
      dataIndex: 'DbName',
      key: 'DbName',
      width: 140,
      ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v || '-'}</span>,
    }] : []),
    {
      title: 'Label',
      dataIndex: 'Label',
      key: 'Label',
      width: 220,
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text strong style={{ fontSize: 12 }}>{v}</Typography.Text>
      ),
    },
    {
      title: 'State',
      dataIndex: 'State',
      key: 'State',
      width: 110,
      render: (v: string) => (
        <Tag color={getStateColor(v)} style={{ borderRadius: 4 }}>{v}</Tag>
      ),
    },
    {
      title: 'Progress',
      dataIndex: 'Progress',
      key: 'Progress',
      width: 150,
      render: (v: unknown, record: Record<string, unknown>) => {
        const pct = parseProgress(v);
        const state = String(record.State || '');
        if (state === 'FINISHED') return <Progress percent={100} size="small" />;
        if (state === 'CANCELLED') return <span style={{ color: 'var(--sr-text-muted)', fontSize: 12 }}>-</span>;
        if (pct !== null) return <Progress percent={pct} size="small" status="active" />;
        return <span style={{ fontSize: 11, color: 'var(--sr-text-muted)' }}>{v ? String(v) : '-'}</span>;
      },
    },
    {
      title: 'Type',
      dataIndex: 'Type',
      key: 'Type',
      width: 120,
      render: (v: string) => {
        const label = v || '-';
        const color = label.includes('STREAM') ? 'blue' : label.includes('BROKER') ? 'green' : label.includes('INSERT') ? 'purple' : undefined;
        return <Tag color={color} style={{ borderRadius: 4, fontSize: 11 }}>{label}</Tag>;
      },
    },
    {
      title: 'Table',
      dataIndex: 'TableName',
      key: 'TableName',
      width: 140,
      ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v || '-'}</span>,
    },
    {
      title: 'Created',
      dataIndex: 'CreateTime',
      key: 'CreateTime',
      width: 160,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v || '-'}</span>,
    },
    {
      title: 'Finished',
      dataIndex: 'LoadFinishTime',
      key: 'LoadFinishTime',
      width: 160,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v || '-'}</span>,
    },
    {
      title: 'ETL Info',
      dataIndex: 'EtlInfo',
      key: 'EtlInfo',
      width: 200,
      ellipsis: true,
      render: (v: string) => {
        if (!v || v === 'NULL') return <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
        return (
          <Tooltip title={v}>
            <span style={{ fontSize: 11, fontFamily: 'monospace' }}>{v}</span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Error',
      dataIndex: 'ErrorMsg',
      key: 'ErrorMsg',
      width: 200,
      ellipsis: true,
      render: (v: string) => {
        if (!v || v === 'NULL') return <span style={{ color: 'var(--sr-text-muted)' }}>-</span>;
        return (
          <Tooltip title={v}>
            <span style={{ fontSize: 11, color: '#ef4444' }}>{v}</span>
          </Tooltip>
        );
      },
    },
    ...(role === 'admin'
      ? [
          {
            title: '',
            key: 'actions',
            width: 60,
            render: (_: unknown, record: Record<string, unknown>) => {
              const state = String(record.State || '');
              if (state === 'FINISHED' || state === 'CANCELLED') return null;
              return (
                <Tooltip title="Cancel job">
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<StopOutlined />}
                    onClick={() => handleCancel(String(record.Label), String(record.DbName || database))}
                  />
                </Tooltip>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {filteredData.length > 0 ? `${filteredData.length} load job${filteredData.length !== 1 ? 's' : ''}` : ''}
        </Typography.Text>
        <AutoRefresh onRefresh={loadData} loading={loading} />
      </div>
      <Table
        className="sr-table"
        columns={columns}
        dataSource={filteredData.map((d, i) => ({ ...d, key: String(d.Label || i) }))}
        size="small"
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} total` }}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <div style={{ padding: '24px 0', color: 'var(--sr-text-muted)' }}>
              No batch load jobs found in this database.
            </div>
          ),
        }}
      />
    </div>
  );
}
