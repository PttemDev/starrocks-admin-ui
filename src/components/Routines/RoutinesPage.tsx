import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Alert, Typography, Tooltip, Row, Col,
} from 'antd';
import {
  ScheduleOutlined,
  CheckCircleFilled,
  PauseCircleFilled,
  CloseCircleFilled,
  ClockCircleFilled,
  InboxOutlined,
  WarningFilled,
} from '@ant-design/icons';
import { fetchRoutines } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { healthIssue, toJob } from '../../utils/routineLoad';
import RoutineLoadTable from '../shared/RoutineLoadTable';
import AutoRefresh from '../shared/AutoRefresh';

function StatMini({
  icon,
  iconColor,
  count,
  label,
}: {
  icon: React.ReactNode;
  iconColor: string;
  count: number;
  label: string;
}) {
  return (
    <div
      className="sr-stat-card"
      style={{ padding: '12px 16px' }}
    >
      <div style={{ color: iconColor, fontSize: 18 }}>{icon}</div>
      <div className="stat-content">
        <div className="stat-value" style={{ fontSize: 22 }}>{count}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function RoutinesPage() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may write state — a slow response for the previous
  // environment must not overwrite the current one.
  const requestSeq = useRef(0);

  const loadData = useCallback(() => {
    if (!selectedEnv) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    fetchRoutines(selectedEnv)
      .then((rows) => { if (seq === requestSeq.current) setData(rows); })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        // Handle expected errors gracefully
        const msg = err.message || '';
        if (msg.includes('No database selected') || msg.includes('1046')) {
          setError(null);
          setData([]);
        } else {
          setError(msg);
        }
      })
      .finally(() => { if (seq === requestSeq.current) setLoading(false); });
  }, [selectedEnv]);

  useEffect(() => {
    setData([]);
    loadData();
  }, [loadData]);

  const counts = useMemo(() => {
    const jobs = data.map(toJob);
    const by = (states: string[]) => jobs.filter((j) => states.includes(j.state)).length;
    return {
      running: by(['RUNNING', 'UNSTABLE']),
      paused: by(['PAUSED']),
      stopped: by(['STOPPED', 'CANCELLED']),
      scheduling: by(['NEED_SCHEDULE']),
      attention: jobs.filter((j) => healthIssue(j)).length,
    };
  }, [data]);

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to view routine jobs."
        type="info"
        showIcon
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <ScheduleOutlined style={{ marginRight: 8 }} />
            Routine Jobs
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Overview of all routine load jobs across all databases in this environment.
          </Typography.Text>
        </div>
        <AutoRefresh onRefresh={loadData} loading={loading} />
      </div>

      {/* Stat Cards */}
      {data.length > 0 && (
        <Row gutter={[12, 12]}>
          <Col flex="1 1 160px">
            <StatMini icon={<CheckCircleFilled />} iconColor="var(--sr-success)" count={counts.running} label="Running" />
          </Col>
          <Col flex="1 1 160px">
            <StatMini icon={<PauseCircleFilled />} iconColor="var(--sr-warning)" count={counts.paused} label="Paused" />
          </Col>
          <Col flex="1 1 160px">
            <StatMini icon={<CloseCircleFilled />} iconColor="var(--sr-danger)" count={counts.stopped} label="Stopped" />
          </Col>
          <Col flex="1 1 160px">
            <StatMini icon={<ClockCircleFilled />} iconColor="var(--sr-info)" count={counts.scheduling} label="Scheduling" />
          </Col>
          <Col flex="1 1 160px">
            <Tooltip title="Live jobs paused by the system or reporting task errors (e.g. an unreachable broker) — look for the warning icon in the table">
              <div>
                <StatMini icon={<WarningFilled />} iconColor="var(--sr-warning)" count={counts.attention} label="Need attention" />
              </div>
            </Tooltip>
          </Col>
        </Row>
      )}

      {/* Error */}
      {error && (
        <Alert
          message="Failed to load routine jobs"
          description={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
        />
      )}

      {/* Content */}
      {!loading && !error && data.length === 0 && (
        <div className="sr-card" style={{ padding: 16 }}>
          <div className="sr-empty-state">
            <InboxOutlined className="empty-icon" />
            <div className="empty-title">No routine jobs found</div>
            <div className="empty-desc">
              No routine load jobs are running in this cluster.
              Go to the Ingestion page to create a new routine load job.
            </div>
          </div>
        </div>
      )}

      {(data.length > 0 || loading) && (
        <div className="sr-card" style={{ padding: 16 }}>
          {data.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              {data.length} routine job{data.length !== 1 ? 's' : ''} across all databases
            </Typography.Text>
          )}
          <RoutineLoadTable
            data={data}
            loading={loading && data.length === 0}
            onRefresh={loadData}
            showDbColumn={true}
          />
        </div>
      )}
    </div>
  );
}
