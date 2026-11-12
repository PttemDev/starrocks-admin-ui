import { useEffect, useMemo, useState } from 'react';
import {
  Modal, Tabs, Button, Space, Tag, Tooltip, Alert, Typography, Form, Input, InputNumber, Switch,
  AutoComplete, Segmented, Table, Collapse, message,
} from 'antd';
import {
  EyeOutlined, CopyOutlined, ThunderboltOutlined, SettingOutlined, CodeOutlined,
  PauseCircleOutlined, SaveOutlined, PlusOutlined, ExclamationCircleFilled, LoadingOutlined,
} from '@ant-design/icons';
import { Editor } from '@monaco-editor/react';
import { alterRoutineLoad, executeRoutineLoadCommand } from '../../api/client';
import type { RoutineLoadAlterResult } from '../../api/types';
import { useTheme } from '../../hooks/useTheme';
import RoutineLoadStateTag from './RoutineLoadStateTag';
import {
  type AlterChanges, type OffsetMode, type RoutineLoadJob,
  ACTIVE_STATES, FINAL_STATES, buildAlterPreview, buildCreateSQL, isMasked, looksLikeError,
  normalizeBrokers, parseCreateTarget, pausedByUser, quoteIdent, sortedPartitions, validBrokers,
} from '../../utils/routineLoad';

export type DetailTab = 'overview' | 'settings' | 'sql';

interface Props {
  job: RoutineLoadJob | null;
  open: boolean;
  initialTab?: DetailTab;
  env: string;
  canEdit: boolean;
  onClose: () => void;
  /** Re-fetch the job list; the modal reads the live job back through `job`. */
  onRefresh: () => void;
}

// ── Settings model ────────────────────────────────────────────────────

type FieldKind = 'int' | 'float' | 'bool' | 'text' | 'tz' | 'json';

interface JobField {
  key: string;      // ALTER property
  showKey: string;  // SHOW ROUTINE LOAD JobProperties key
  label: string;
  kind: FieldKind;
  tooltip: string;
  jsonOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

/** Every job property ALTER ROUTINE LOAD accepts (verified on StarRocks 4.0.4). */
const JOB_FIELDS: JobField[] = [
  { key: 'desired_concurrent_number', showKey: 'desireTaskConcurrentNum', label: 'Concurrency', kind: 'int', min: 1, max: 64, tooltip: 'Upper bound on parallel load tasks. Actual = min(this, partitions, alive BEs).' },
  { key: 'max_batch_interval', showKey: 'maxBatchIntervalS', label: 'Batch interval', kind: 'int', min: 1, suffix: 's', tooltip: 'Seconds between two batches (task schedule interval).' },
  { key: 'max_batch_rows', showKey: 'maxBatchRows', label: 'Batch rows', kind: 'int', min: 1, step: 10000, tooltip: 'Used for the error window: max_error_number is checked per 10 × this many rows.' },
  { key: 'max_batch_size', showKey: 'maxBatchSize', label: 'Batch size', kind: 'int', min: 1, suffix: 'B', tooltip: 'Max bytes a task reads per batch. Leave empty to keep the current value.' },
  { key: 'task_consume_second', showKey: 'taskConsumeSecond', label: 'Task consume time', kind: 'int', min: 1, suffix: 's', tooltip: 'Max time each task spends consuming from Kafka.' },
  { key: 'task_timeout_second', showKey: 'taskTimeoutSecond', label: 'Task timeout', kind: 'int', min: 1, suffix: 's', tooltip: 'Timeout of a single load task. Should be ≥ 4 × task consume time.' },
  { key: 'max_error_number', showKey: 'maxErrorNum', label: 'Max error rows', kind: 'int', min: 0, tooltip: 'Error rows tolerated per error window before the job pauses.' },
  { key: 'max_filter_ratio', showKey: 'maxFilterRatio', label: 'Max filter ratio', kind: 'float', min: 0, max: 1, step: 0.05, tooltip: 'Max share of filtered rows per window (0–1) before the job pauses.' },
  { key: 'timezone', showKey: 'timezone', label: 'Timezone', kind: 'tz', tooltip: 'Timezone for time conversion functions in the load.' },
  { key: 'strict_mode', showKey: 'strict_mode', label: 'Strict mode', kind: 'bool', tooltip: 'Reject rows whose columns fail type conversion instead of loading NULL.' },
  { key: 'pause_on_fatal_parse_error', showKey: 'pause_on_fatal_parse_error', label: 'Pause on fatal parse error', kind: 'bool', tooltip: 'Pause the job when a message cannot be parsed at all.' },
  { key: 'jsonpaths', showKey: 'jsonpaths', label: 'JSON paths', kind: 'json', jsonOnly: true, tooltip: 'JSON array of paths, one per column in COLUMNS order. Example: ["$.id", "$.user.name"]' },
  { key: 'json_root', showKey: 'json_root', label: 'JSON root', kind: 'text', jsonOnly: true, tooltip: 'Path of the element to treat as the record, e.g. $.data. Empty = whole message.' },
  { key: 'strip_outer_array', showKey: 'strip_outer_array', label: 'Strip outer array', kind: 'bool', jsonOnly: true, tooltip: 'Each message is a JSON array; load every element as a row.' },
];

const TIMEZONES = [
  'Etc/UTC', 'UTC', 'Europe/Istanbul', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Dubai', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles',
];

interface CustomProp { key: string; value: string; masked: boolean; isNew?: boolean }

interface Settings {
  brokers: string;
  groupId: string;
  registry: string;
  custom: CustomProp[];
  /** partition → next offset to consume ('' = unchanged) */
  offsets: Record<string, string>;
  props: Record<string, string>;
  columns: string;
  where: string;
}

const clause = (v: string | undefined) => (v && v !== '*' && v !== 'null' ? v : '');

function initialSettings(j: RoutineLoadJob): Settings {
  const props: Record<string, string> = {};
  for (const f of JOB_FIELDS) props[f.key] = j.job[f.showKey] ?? '';
  return {
    brokers: j.brokers,
    groupId: j.custom['group.id'] ?? '',
    registry: j.source['confluent.schema.registry.url'] ?? '',
    custom: Object.entries(j.custom)
      .filter(([k]) => k !== 'group.id')
      .map(([key, value]) => ({ key, value: isMasked(value) ? '' : value, masked: isMasked(value) })),
    offsets: {},
    props,
    columns: clause(j.job.columnToColumnExpr),
    where: clause(j.job.whereExpr),
  };
}

const sameValue = (kind: FieldKind, a: string, b: string) =>
  kind === 'int' || kind === 'float'
    ? (a.trim() === '' && b.trim() === '') || Number(a) === Number(b)
    : a.trim() === b.trim();

const OFFSET_RE = /^(\d+|OFFSET_BEGINNING|OFFSET_END)$/;

/** Only what differs from the job's current settings goes to ALTER. */
function diffSettings(init: Settings, s: Settings): AlterChanges {
  const job: Record<string, string> = {};
  for (const f of JOB_FIELDS) {
    const v = s.props[f.key] ?? '';
    if (sameValue(f.kind, init.props[f.key] ?? '', v)) continue;
    if (v.trim() === '' && f.kind !== 'text') continue; // numbers/bools can't be "cleared"
    job[f.key] = v.trim();
  }
  const src: Record<string, string> = {};
  const brokers = normalizeBrokers(s.brokers);
  if (brokers !== init.brokers) src.kafka_broker_list = brokers;
  if (s.groupId.trim() && s.groupId.trim() !== init.groupId) src['property.group.id'] = s.groupId.trim();
  if (s.registry.trim() !== init.registry && s.registry.trim()) src['confluent.schema.registry.url'] = s.registry.trim();
  for (const c of s.custom) {
    const key = c.key.trim().replace(/^property\./, '');
    if (!key || !c.value.trim()) continue;
    const before = init.custom.find((x) => x.key === key);
    if (!before || before.value !== c.value.trim()) src[`property.${key}`] = c.value.trim();
  }
  const reset = Object.entries(s.offsets).filter(([, v]) => v.trim() !== '');
  if (reset.length) {
    reset.sort(([a], [b]) => Number(a) - Number(b));
    src.kafka_partitions = reset.map(([p]) => p).join(',');
    src.kafka_offsets = reset.map(([, v]) => v.trim()).join(',');
  }
  const changes: AlterChanges = {};
  if (Object.keys(job).length) changes.job_properties = job;
  if (Object.keys(src).length) changes.data_source_properties = src;
  if (s.columns.trim() && s.columns.trim() !== init.columns) changes.columns = s.columns.trim();
  if (s.where.trim() && s.where.trim() !== init.where) changes.where = s.where.trim();
  return changes;
}

function validate(s: Settings, isJson: boolean): string | null {
  if (!validBrokers(normalizeBrokers(s.brokers))) return 'Broker list must be host:port entries separated by commas.';
  for (const [p, v] of Object.entries(s.offsets)) {
    if (v.trim() && !OFFSET_RE.test(v.trim())) return `Partition ${p}: offset must be a number, OFFSET_BEGINNING or OFFSET_END.`;
  }
  if (isJson && s.props.jsonpaths?.trim()) {
    try {
      if (!Array.isArray(JSON.parse(s.props.jsonpaths))) return 'JSON paths must be a JSON array.';
    } catch {
      return 'JSON paths is not valid JSON.';
    }
  }
  return null;
}

// ── Small presentational pieces ───────────────────────────────────────

const fmtTs = (ms: number) => new Date(ms).toLocaleString();
const fmtNum = (n: number | undefined) => (n === undefined ? '-' : n.toLocaleString());

function fmtBytes(n: number | undefined): string {
  if (n === undefined) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function SummaryCard({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sr-card-alt)', borderRadius: 8, padding: '10px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--sr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontWeight: 600, marginTop: 2, overflowWrap: 'anywhere' }}>{children}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--sr-text-muted)', overflowWrap: 'anywhere' }}>{sub}</div>}
    </div>
  );
}

const sectionTitle = (t: string) => (
  <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>{t}</Typography.Text>
);

function PropertiesTable({ job }: { job: RoutineLoadJob }) {
  const rows = [
    ...Object.entries(job.source).map(([k, v]) => ({ section: 'kafka', k, v })),
    ...Object.entries(job.custom).map(([k, v]) => ({ section: 'property', k, v })),
    ...Object.entries(job.job).map(([k, v]) => ({ section: 'job', k, v })),
  ];
  if (!rows.length) return null;
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--sr-border)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <tbody>
          {rows.map(({ section, k, v }, i) => (
            <tr key={`${section}-${k}`} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--sr-border-subtle)' : undefined }}>
              <td style={{ padding: '6px 12px', color: 'var(--sr-text-secondary)', whiteSpace: 'nowrap', width: 220, verticalAlign: 'top', background: 'var(--sr-card-alt)' }}>
                <Space size={4}>
                  <Tag style={{ fontSize: 9, lineHeight: '14px', margin: 0, borderRadius: 3, padding: '0 4px' }} color={section === 'job' ? 'default' : 'cyan'}>
                    {section}
                  </Tag>
                  {k}
                </Space>
              </td>
              <td style={{ padding: '6px 12px', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 11 }}>
                {v === '' ? <span style={{ color: 'var(--sr-text-faint)' }}>(empty)</span> : v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────

export default function RoutineLoadDetailModal({ job, open, initialTab = 'overview', env, canEdit, onClose, onRefresh }: Props) {
  const { isDark } = useTheme();
  const [tab, setTab] = useState<DetailTab>(initialTab);

  // Settings tab
  const [settings, setSettings] = useState<Settings | null>(null);
  const [resume, setResume] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<(RoutineLoadAlterResult & { otherMsg: string; reason: string }) | null>(null);
  const [watchUntil, setWatchUntil] = useState(0);

  // SQL tab
  const [offsetMode, setOffsetMode] = useState<OffsetMode>('progress');
  const [sql, setSql] = useState('');
  const [sqlDirty, setSqlDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  const jobKey = job?.key;
  const initial = useMemo(() => (job ? initialSettings(job) : null), [job]);

  // Fresh state each time the modal opens on a job. Background refreshes hand us
  // a new `job` object for the same key; those must not wipe the user's edits.
  useEffect(() => {
    if (!open || !job) return;
    setTab(initialTab);
    setSettings(initialSettings(job));
    setResume(job.state !== 'PAUSED' || !pausedByUser(job.reason));
    setApplyError(null);
    setApplyResult(null);
    setWatchUntil(0);
    setOffsetMode('progress');
    setSqlDirty(false);
    setSqlError(null);
  }, [open, jobKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate the re-create SQL from live data until the user edits it, so
  // offsets track the job (e.g. right after "Pause & refresh").
  useEffect(() => {
    if (open && job && !sqlDirty) setSql(buildCreateSQL(job, offsetMode));
  }, [open, job, offsetMode, sqlDirty]);

  // After an ALTER, poll for a short while: a bad broker doesn't fail the ALTER,
  // it shows up seconds later as a task error or an automatic PAUSE.
  useEffect(() => {
    if (!watchUntil) return;
    const t = setInterval(() => {
      if (Date.now() > watchUntil) { setWatchUntil(0); return; }
      onRefresh();
    }, 3000);
    return () => clearInterval(t);
  }, [watchUntil, onRefresh]);

  if (!job) return null;

  const target = `${quoteIdent(job.db)}.${quoteIdent(job.name)}`;
  const isFinal = FINAL_STATES.has(job.state);
  const isActive = ACTIVE_STATES.has(job.state);
  const isJson = (job.job.format || '').toLowerCase() === 'json';

  const changes = settings && initial ? diffSettings(initial, settings) : {};
  const hasChanges = Object.keys(changes).length > 0;
  const invalid = settings ? validate(settings, isJson) : null;
  const preview = hasChanges ? buildAlterPreview(job, changes, resume) : '';

  const patch = (p: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...p } : s));
  const patchProp = (k: string, v: string) => setSettings((s) => (s ? { ...s, props: { ...s.props, [k]: v } } : s));

  const copy = (text: string, what = 'SQL') => {
    navigator.clipboard.writeText(text);
    message.success(`${what} copied`);
  };

  const pauseJob = async () => {
    setBusy(true);
    setSqlError(null);
    try {
      await executeRoutineLoadCommand(env, `PAUSE ROUTINE LOAD FOR ${target}`);
      message.success('Job paused — offsets are now final');
      setSqlDirty(false);
      onRefresh();
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const res = await alterRoutineLoad(env, { database: job.db, name: job.name, ...changes, resume });
      setApplyResult({ ...res, otherMsg: job.otherMsg, reason: job.reason });
      if (res.warning) message.warning(res.warning);
      else message.success(res.resumed ? 'Settings applied, job resumed' : 'Settings applied');
      setSettings((s) => (s ? { ...s, offsets: {} } : s));
      setWatchUntil(Date.now() + 20_000);
      onRefresh();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
      onRefresh();
    } finally {
      setApplying(false);
    }
  };

  const recreate = () => {
    setSqlError(null);
    const t = parseCreateTarget(sql);
    if (!t) { setSqlError('The SQL must start with CREATE ROUTINE LOAD <db>.<job>.'); return; }
    if (!/FROM\s+KAFKA/i.test(sql) || !/kafka_broker_list/i.test(sql) || !/kafka_topic/i.test(sql)) {
      setSqlError('The SQL has no FROM KAFKA (...) clause with kafka_broker_list and kafka_topic.');
      return;
    }
    if (/'\*{3,}'/.test(sql)) {
      setSqlError('The SQL still contains masked values (******). StarRocks hides secrets such as sasl.password — type the real values in before creating.');
      return;
    }
    const sameJob = t.db === job.db && t.name === job.name;
    const stopFirst = sameJob && !isFinal;
    Modal.confirm({
      title: stopFirst ? `Stop and re-create "${job.name}"?` : `Create routine load "${t.db}.${t.name}"?`,
      icon: <ExclamationCircleFilled />,
      width: 520,
      content: stopFirst ? (
        <div>
          <p style={{ margin: '0 0 8px' }}>This runs two statements:</p>
          <ol style={{ margin: 0, paddingInlineStart: 18 }}>
            <li><code>STOP ROUTINE LOAD</code> — permanent, the current job cannot be resumed afterwards.</li>
            <li><code>CREATE ROUTINE LOAD</code> with the SQL in the editor.</li>
          </ol>
          <p style={{ margin: '8px 0 0' }}>
            {offsetMode === 'progress' && !sqlDirty
              ? 'The new job continues from the current offsets, so nothing is skipped or loaded twice.'
              : 'Check the kafka_offsets / kafka_default_offsets in the SQL — a wrong start position skips data or loads it twice.'}
          </p>
        </div>
      ) : sameJob ? 'The job is already stopped; this creates it again with the SQL in the editor.'
        : 'The job name in the SQL differs from this job, so a new job is created and this one is left untouched.',
      okText: stopFirst ? 'Stop & Re-create' : 'Create',
      okType: stopFirst ? 'danger' : 'primary',
      onOk: async () => {
        setBusy(true);
        let stopped = false;
        try {
          if (stopFirst) {
            await executeRoutineLoadCommand(env, `STOP ROUTINE LOAD FOR ${target}`);
            stopped = true;
          }
          await executeRoutineLoadCommand(env, sql);
          message.success(stopFirst ? 'Routine load re-created' : 'Routine load created');
          onRefresh();
          onClose();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setSqlError(stopped
            ? `The old job was STOPPED, but CREATE failed: ${msg}. The SQL is still in the editor — fix it and click Create again.`
            : msg);
          onRefresh();
        } finally {
          setBusy(false);
        }
      },
    });
  };

  // ── Overview ──
  const partitions = Array.from(new Set([...Object.keys(job.progress), ...Object.keys(job.latest), ...Object.keys(job.lag)]))
    .sort((a, b) => Number(a) - Number(b));
  const lagTone = job.totalLag === null ? undefined : job.totalLag > 0 ? 'var(--sr-warning)' : 'var(--sr-success)';

  const overview = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {job.reason && (
        <Alert
          type={job.state === 'PAUSED' || isFinal ? 'error' : 'info'}
          showIcon
          message="State change reason"
          description={<span style={{ wordBreak: 'break-word' }}>{job.reason}</span>}
          style={{ borderRadius: 8 }}
        />
      )}
      {job.otherMsg && (
        <Alert
          type={looksLikeError(job.otherMsg) ? 'warning' : 'info'}
          showIcon
          message="Last task message"
          description={<span style={{ wordBreak: 'break-word', fontSize: 12 }}>{job.otherMsg}</span>}
          action={canEdit && !isFinal && /broker|connect|No route|transport/i.test(job.otherMsg) ? (
            <Button size="small" onClick={() => setTab('settings')}>Change broker</Button>
          ) : undefined}
          style={{ borderRadius: 8 }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <SummaryCard label="Target" sub={`created ${String(job.raw.CreateTime ?? '-')}`}>{job.db}.{job.table}</SummaryCard>
        <SummaryCard label={`Source · ${job.sourceType}`} sub={job.brokers}>{job.topic || '-'}</SummaryCard>
        <SummaryCard label="Loaded" sub={`${fmtNum(job.stats.errorRows)} error · ${fmtNum(job.stats.unselectedRows)} filtered rows`}>
          {fmtNum(job.stats.loadedRows)} rows
        </SummaryCard>
        <SummaryCard
          label="Lag"
          sub={job.earliestTs ? `last message ${fmtTs(job.earliestTs)}` : `${partitions.length} partitions`}
        >
          <span style={{ color: lagTone }}>{job.totalLag === null ? '-' : job.totalLag.toLocaleString()}</span>
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--sr-text-muted)' }}> msgs · {String(job.raw.CurrentTaskNum ?? 0)} tasks</span>
        </SummaryCard>
      </div>

      {partitions.length > 0 && (
        <div>
          {sectionTitle('Partitions')}
          <Table
            size="small"
            pagination={false}
            rowKey="p"
            dataSource={partitions.map((p) => ({ p }))}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: 'Partition', dataIndex: 'p', width: 90 },
              { title: 'Consumed offset', render: (_, r) => <code>{job.progress[r.p] ?? '-'}</code> },
              { title: 'Latest offset', render: (_, r) => <code>{job.latest[r.p] ?? '-'}</code> },
              {
                title: 'Lag',
                render: (_, r) => {
                  const n = Number(job.lag[r.p]);
                  return Number.isFinite(n)
                    ? <span style={{ color: n > 0 ? 'var(--sr-warning)' : 'var(--sr-success)', fontFamily: 'monospace' }}>{n.toLocaleString()}</span>
                    : '-';
                },
              },
              {
                title: 'Last message time',
                render: (_, r) => {
                  const n = Number(job.tsProgress[r.p]);
                  return n > 1_000_000_000_000 ? fmtTs(n) : '-';
                },
              },
            ]}
          />
        </div>
      )}

      <div>
        {sectionTitle('Statistics')}
        <Space size={[24, 4]} wrap style={{ fontSize: 12 }}>
          <span>Received: <b>{fmtBytes(job.stats.receivedBytes)}</b> ({fmtBytes(job.stats.receivedBytesRate)}/s)</span>
          <span>Load rate: <b>{fmtNum(job.stats.loadRowsRate)}</b> rows/s</span>
          <span>Committed tasks: <b>{fmtNum(job.stats.committedTaskNum)}</b></span>
          <span>Aborted tasks: <b>{fmtNum(job.stats.abortedTaskNum)}</b></span>
        </Space>
      </div>

      {(job.errorLogUrls.length > 0 || String(job.raw.TrackingSQL ?? '').trim()) && (
        <Space size={12} wrap>
          {job.errorLogUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">Error log{job.errorLogUrls.length > 1 ? ` ${i + 1}` : ''}</a>
          ))}
          {String(job.raw.TrackingSQL ?? '').trim() && (
            <Button size="small" icon={<CopyOutlined />} onClick={() => copy(String(job.raw.TrackingSQL), 'Tracking SQL')}>
              Copy tracking SQL
            </Button>
          )}
        </Space>
      )}

      <div>
        {sectionTitle('Properties')}
        <PropertiesTable job={job} />
      </div>
    </div>
  );

  // ── Settings ──
  const settingsTab = settings && (
    isFinal ? (
      <Alert
        type="info"
        showIcon
        message="This job is stopped"
        description="Stopped and cancelled jobs can't be altered. Use the SQL tab to create it again — it continues from the last offsets by default."
        action={<Button size="small" onClick={() => setTab('sql')}>Open SQL</Button>}
      />
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 8 }}
          message={isActive
            ? 'Applying pauses the job, runs ALTER ROUTINE LOAD and resumes it. Offsets are kept.'
            : 'The job is paused; ALTER ROUTINE LOAD is applied directly. Offsets are kept.'}
          description="Topic, data format and target table can't be altered — change those from the SQL tab (re-create)."
        />

        <Form layout="vertical" size="middle">
          {sectionTitle('Kafka source')}
          <Form.Item
            label="Broker list"
            required
            tooltip="Comma-separated host:port list. The new brokers are contacted on the next scheduling round — watch the status below after applying."
            validateStatus={validBrokers(normalizeBrokers(settings.brokers)) ? undefined : 'error'}
            help={validBrokers(normalizeBrokers(settings.brokers)) ? undefined : 'Use host:port, separated by commas'}
          >
            <Input
              value={settings.brokers}
              onChange={(e) => patch({ brokers: e.target.value })}
              onBlur={() => patch({ brokers: normalizeBrokers(settings.brokers) })}
              placeholder="broker1:9092,broker2:9092"
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 16 }}>
            <Form.Item label="Topic" tooltip="Can't be altered — re-create the job to read another topic.">
              <Input value={job.topic} disabled />
            </Form.Item>
            <Form.Item label="Consumer group (property.group.id)" tooltip="Kafka consumer group the job commits under.">
              <Input value={settings.groupId} onChange={(e) => patch({ groupId: e.target.value })} placeholder="auto-generated" />
            </Form.Item>
          </div>

          <Collapse
            size="small"
            style={{ marginBottom: 16 }}
            items={[
              {
                key: 'custom',
                label: `Custom Kafka properties (${settings.custom.length})`,
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Sent as <code>property.&lt;key&gt;</code> — e.g. <code>security.protocol</code>, <code>sasl.username</code>,
                      {' '}<code>kafka_default_offsets</code>. Existing keys can be changed but not removed.
                    </Typography.Text>
                    {settings.custom.map((c, i) => (
                      <Space.Compact key={i} style={{ width: '100%' }}>
                        <Input
                          value={c.key}
                          disabled={!c.isNew}
                          placeholder="key"
                          style={{ width: '40%', fontFamily: 'monospace' }}
                          onChange={(e) => patch({ custom: settings.custom.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })}
                        />
                        <Input
                          value={c.value}
                          placeholder={c.masked ? '•••••• (hidden by StarRocks, unchanged)' : 'value'}
                          style={{ width: '60%', fontFamily: 'monospace' }}
                          onChange={(e) => patch({ custom: settings.custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                        />
                      </Space.Compact>
                    ))}
                    <Button
                      size="small"
                      icon={<PlusOutlined />}
                      style={{ alignSelf: 'flex-start' }}
                      onClick={() => patch({ custom: [...settings.custom, { key: '', value: '', masked: false, isNew: true }] })}
                    >
                      Add property
                    </Button>
                    <Form.Item label="Confluent schema registry URL" style={{ marginBottom: 0, marginTop: 8 }}>
                      <Input value={settings.registry} onChange={(e) => patch({ registry: e.target.value })} placeholder="http://registry:8081" />
                    </Form.Item>
                  </div>
                ),
              },
              {
                key: 'offsets',
                label: 'Reset partition offsets',
                children: (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      Sets the <b>next</b> offset to consume for a partition (skip ahead or re-read). Leave empty to keep the
                      current position. Only partitions the job already consumes can be changed.
                    </Typography.Text>
                    <Table
                      size="small"
                      pagination={false}
                      rowKey="p"
                      dataSource={sortedPartitions(job.progress).map((p) => ({ p }))}
                      columns={[
                        { title: 'Partition', dataIndex: 'p', width: 90 },
                        { title: 'Consumed', render: (_, r) => <code>{job.progress[r.p]}</code> },
                        { title: 'Latest', render: (_, r) => <code>{job.latest[r.p] ?? '-'}</code> },
                        {
                          title: 'Next offset',
                          render: (_, r) => {
                            const v = settings.offsets[r.p] ?? '';
                            return (
                              <AutoComplete
                                value={v}
                                style={{ width: 200 }}
                                placeholder="unchanged"
                                options={[{ value: 'OFFSET_BEGINNING' }, { value: 'OFFSET_END' }]}
                                status={v.trim() && !OFFSET_RE.test(v.trim()) ? 'error' : undefined}
                                onChange={(nv) => patch({ offsets: { ...settings.offsets, [r.p]: String(nv ?? '') } })}
                              />
                            );
                          },
                        },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />

          {sectionTitle('Job properties')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: 16 }}>
            {JOB_FIELDS.filter((f) => !f.jsonOnly && f.kind !== 'bool').map((f) => (
              <Form.Item key={f.key} label={f.label} tooltip={f.tooltip}>
                {f.kind === 'tz' ? (
                  <AutoComplete
                    value={settings.props[f.key]}
                    options={TIMEZONES.map((value) => ({ value }))}
                    filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                    onChange={(v) => patchProp(f.key, String(v ?? ''))}
                    placeholder="server default"
                  />
                ) : (
                  <InputNumber
                    value={settings.props[f.key] === '' ? null : Number(settings.props[f.key])}
                    onChange={(v) => patchProp(f.key, v === null || v === undefined ? '' : String(v))}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    suffix={f.suffix}
                    placeholder={f.key === 'max_batch_size' ? 'unchanged' : undefined}
                    style={{ width: '100%' }}
                  />
                )}
              </Form.Item>
            ))}
          </div>
          <Space size={24} wrap style={{ marginBottom: 16 }}>
            {JOB_FIELDS.filter((f) => f.kind === 'bool' && (!f.jsonOnly || isJson)).map((f) => (
              <Tooltip key={f.key} title={f.tooltip}>
                <Space size={8}>
                  <Switch
                    size="small"
                    checked={settings.props[f.key] === 'true'}
                    onChange={(v) => patchProp(f.key, String(v))}
                  />
                  <span>{f.label}</span>
                </Space>
              </Tooltip>
            ))}
          </Space>

          {isJson && (
            <>
              <Form.Item label="JSON paths" tooltip={JOB_FIELDS.find((f) => f.key === 'jsonpaths')?.tooltip}>
                <Input.TextArea
                  value={settings.props.jsonpaths}
                  onChange={(e) => patchProp('jsonpaths', e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>
              <Form.Item label="JSON root" tooltip={JOB_FIELDS.find((f) => f.key === 'json_root')?.tooltip}>
                <Input value={settings.props.json_root} onChange={(e) => patchProp('json_root', e.target.value)} placeholder="$.data" />
              </Form.Item>
            </>
          )}

          <Collapse
            size="small"
            style={{ marginBottom: 16 }}
            items={[{
              key: 'load',
              label: 'Column mapping & filter',
              children: (
                <>
                  <Form.Item label="COLUMNS" tooltip="Replaces the column mapping, e.g. id, name, dt=from_unixtime(ts). Order must match JSON paths.">
                    <Input.TextArea
                      value={settings.columns}
                      onChange={(e) => patch({ columns: e.target.value })}
                      autoSize={{ minRows: 2, maxRows: 8 }}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                      placeholder="all table columns"
                    />
                  </Form.Item>
                  <Form.Item label="WHERE" tooltip="Rows not matching the predicate are skipped (counted as filtered)." style={{ marginBottom: 0 }}>
                    <Input
                      value={settings.where}
                      onChange={(e) => patch({ where: e.target.value })}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                      placeholder="no filter"
                    />
                  </Form.Item>
                </>
              ),
            }]}
          />
        </Form>

        <Space size={8}>
          <Switch size="small" checked={resume} onChange={setResume} />
          <span>Resume the job after applying</span>
          {job.state === 'PAUSED' && pausedByUser(job.reason) && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>(it was paused by a user)</Typography.Text>
          )}
        </Space>

        {preview && (
          <div>
            {sectionTitle('Statements to run')}
            <pre style={{
              margin: 0, padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              background: 'var(--sr-code-bg)', color: 'var(--sr-code-fg)', border: '1px solid var(--sr-code-border)',
            }}
            >
              {preview}
            </pre>
          </div>
        )}

        {invalid && hasChanges && <Alert type="error" showIcon message={invalid} style={{ borderRadius: 8 }} />}
        {applyError && (
          <Alert type="error" showIcon closable onClose={() => setApplyError(null)} message="Apply failed" description={applyError} style={{ borderRadius: 8 }} />
        )}
        {applyResult && (
          <Alert
            type={applyResult.warning ? 'warning' : 'success'}
            showIcon
            style={{ borderRadius: 8 }}
            message={
              <Space size={8} wrap>
                <span>{applyResult.warning || (applyResult.resumed ? 'Applied and resumed.' : 'Applied.')}</span>
                <span>Current state:</span>
                <RoutineLoadStateTag state={job.state} />
                {watchUntil > 0 && <Typography.Text type="secondary" style={{ fontSize: 12 }}><LoadingOutlined /> watching for errors…</Typography.Text>}
              </Space>
            }
            description={
              <>
                {job.reason && job.reason !== applyResult.reason && (
                  <div style={{ color: 'var(--sr-err-fg)', wordBreak: 'break-word' }}>Job state changed: {job.reason}</div>
                )}
                {job.otherMsg && job.otherMsg !== applyResult.otherMsg && looksLikeError(job.otherMsg) && (
                  <div style={{ color: 'var(--sr-warn-fg)', wordBreak: 'break-word' }}>New task error: {job.otherMsg}</div>
                )}
              </>
            }
          />
        )}
      </div>
    )
  );

  // ── SQL / re-create ──
  const sqlTarget = parseCreateTarget(sql);
  const sameName = !!sqlTarget && sqlTarget.db === job.db && sqlTarget.name === job.name;
  const needsPause = canEdit && sameName && isActive && offsetMode === 'progress';

  const sqlTab = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canEdit && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          For changes ALTER can't make (topic, format, target table, partial update…). Re-creating stops this job and
          creates it again under the same name; edit the job name to create a separate copy instead.
        </Typography.Text>
      )}
      <Space size={12} wrap>
        <Typography.Text strong style={{ fontSize: 13 }}>Start from</Typography.Text>
        <Segmented
          size="small"
          value={offsetMode}
          onChange={(v) => { setOffsetMode(v as OffsetMode); setSqlDirty(false); }}
          options={[
            { value: 'progress', label: 'Current offsets' },
            { value: 'default', label: 'Job default' },
            { value: 'beginning', label: 'Beginning' },
            { value: 'end', label: 'End (latest)' },
          ]}
        />
        <Tooltip title="Current offsets: continue right after the last consumed message of each partition (pins those partitions). Job default: the job's kafka_default_offsets, all partitions. Beginning / End: re-read the whole topic / skip to new messages.">
          <Typography.Text type="secondary" style={{ fontSize: 12, cursor: 'help', textDecoration: 'underline dotted' }}>what's this?</Typography.Text>
        </Tooltip>
        {sqlDirty && (
          <Button size="small" type="link" onClick={() => setSqlDirty(false)}>Reset to generated</Button>
        )}
      </Space>

      {needsPause && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 8 }}
          message="The job is still consuming, so these offsets keep moving."
          description="Pause it first — the SQL then picks up the exact position to continue from."
          action={<Button size="small" icon={<PauseCircleOutlined />} loading={busy} onClick={pauseJob}>Pause & refresh</Button>}
        />
      )}

      <div style={{ height: 380, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sr-code-border)' }}>
        <Editor
          language="sql"
          value={sql}
          onChange={(v) => { setSql(v || ''); setSqlDirty(true); }}
          options={{
            readOnly: !canEdit,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 12,
            automaticLayout: true,
          }}
          theme={isDark ? 'vs-dark' : 'vs-light'}
        />
      </div>

      {sqlError && (
        <Alert type="error" showIcon closable onClose={() => setSqlError(null)} message="Execution failed" description={sqlError} style={{ borderRadius: 8 }} />
      )}
    </div>
  );

  const recreateLabel = !sqlTarget || !sameName ? 'Create' : isFinal ? 'Re-create' : 'Stop & Re-create';

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <Button onClick={onClose}>Close</Button>
      <Space wrap>
        {tab === 'settings' && canEdit && !isFinal && (
          <>
            <Button disabled={!hasChanges || applying} onClick={() => initial && setSettings(initial)}>Reset</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={applying}
              disabled={!hasChanges || !!invalid}
              onClick={apply}
            >
              Apply changes
            </Button>
          </>
        )}
        {tab === 'sql' && (
          <>
            <Button type="text" icon={<CopyOutlined />} onClick={() => copy(sql)}>Copy SQL</Button>
            {canEdit && (
              <Tooltip title={needsPause ? 'Pause the job first so the offsets are final' : undefined}>
                <Button
                  type="primary"
                  danger={sameName && !isFinal}
                  icon={<ThunderboltOutlined />}
                  loading={busy}
                  disabled={needsPause}
                  onClick={recreate}
                >
                  {recreateLabel}
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </Space>
    </div>
  );

  return (
    <Modal
      title={
        <Space size={8} wrap>
          <EyeOutlined style={{ color: 'var(--sr-primary)' }} />
          <span>Routine Load: {job.name}</span>
          <RoutineLoadStateTag state={job.state} />
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={980}
      footer={footer}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 } }}
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as DetailTab)}
        items={[
          { key: 'overview', label: <Space size={6}><EyeOutlined />Overview</Space>, children: overview },
          ...(canEdit ? [{ key: 'settings', label: <Space size={6}><SettingOutlined />Settings</Space>, children: settingsTab }] : []),
          { key: 'sql', label: <Space size={6}><CodeOutlined />{canEdit ? 'SQL / Re-create' : 'SQL'}</Space>, children: sqlTab },
        ]}
      />
    </Modal>
  );
}
