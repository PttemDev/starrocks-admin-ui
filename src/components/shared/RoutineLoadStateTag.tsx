import { Tag, Tooltip } from 'antd';

export const routineLoadStates: Record<string, { color: string; label: string; tooltip: string }> = {
  RUNNING: { color: 'green', label: 'Running', tooltip: 'Job is actively loading data from the source' },
  NEED_SCHEDULE: { color: 'blue', label: 'Scheduling', tooltip: 'Job is waiting to be scheduled — will start shortly' },
  UNSTABLE: { color: 'gold', label: 'Unstable', tooltip: 'Job is running but falling behind (lag keeps growing)' },
  PAUSED: { color: 'orange', label: 'Paused', tooltip: 'Job is paused — resume it to continue loading' },
  STOPPED: { color: 'red', label: 'Stopped', tooltip: 'Job has been permanently stopped and cannot be resumed' },
  CANCELLED: { color: 'red', label: 'Cancelled', tooltip: 'Job was cancelled due to an error or manual cancellation' },
};

export default function RoutineLoadStateTag({ state }: { state: string }) {
  const cfg = routineLoadStates[state];
  if (!cfg) return <Tag style={{ borderRadius: 4 }}>{state || '-'}</Tag>;
  return (
    <Tooltip title={cfg.tooltip}>
      <Tag color={cfg.color} style={{ borderRadius: 4, fontWeight: 500, cursor: 'help', marginInlineEnd: 0 }}>
        {cfg.label}
      </Tag>
    </Tooltip>
  );
}
