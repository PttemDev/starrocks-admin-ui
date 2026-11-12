/**
 * Routine load helpers shared by the job table, the detail modal and the create
 * wizard: parsing SHOW ROUTINE LOAD rows and rendering CREATE / ALTER SQL.
 *
 * SHOW ROUTINE LOAD reports properties under its own (camelCase) names —
 * `desireTaskConcurrentNum`, `brokerList`, `topic` — not the `desired_concurrent_number`
 * / `kafka_broker_list` keys the DDL takes, so every SQL builder maps through here.
 */

export type RoutineLoadRow = Record<string, unknown>;

export const ACTIVE_STATES = new Set(['RUNNING', 'NEED_SCHEDULE', 'UNSTABLE']);
export const FINAL_STATES = new Set(['STOPPED', 'CANCELLED']);

/** StarRocks prints secrets (keys containing password/secret) as asterisks. */
export const isMasked = (v: string) => /^\*{3,}$/.test(v);

/** Parse a JSON object column (`{"0":"12"}`); falls back to `k=v; k=v` text. */
export function parseJsonMap(val: unknown): Record<string, string> {
  if (!val || typeof val !== 'string') return {};
  try {
    const obj = JSON.parse(val);
    if (!obj || typeof obj !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return out;
  } catch {
    const out: Record<string, string> = {};
    val.split(/;\s*/).forEach((pair) => {
      const i = pair.indexOf('=');
      if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
    return out;
  }
}

function parseStats(val: unknown): Record<string, number> {
  if (!val || typeof val !== 'string') return {};
  try {
    const obj = JSON.parse(val) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'number') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

const text = (v: unknown) => (v === null || v === undefined || v === 'null' ? '' : String(v));

/** Partition ids in numeric order. */
export const sortedPartitions = (m: Record<string, string>) =>
  Object.keys(m).sort((a, b) => Number(a) - Number(b));

/** A SHOW ROUTINE LOAD row with its JSON columns parsed once. */
export interface RoutineLoadJob {
  key: string;
  id: string;
  name: string;
  db: string;
  table: string;
  state: string;
  sourceType: string;
  job: Record<string, string>;
  source: Record<string, string>;
  custom: Record<string, string>;
  stats: Record<string, number>;
  progress: Record<string, string>;
  latest: Record<string, string>;
  lag: Record<string, string>;
  tsProgress: Record<string, string>;
  totalLag: number | null;
  /** Earliest per-partition timestamp of the last consumed message (epoch ms). */
  earliestTs: number | null;
  topic: string;
  brokers: string;
  reason: string;
  otherMsg: string;
  errorLogUrls: string[];
  raw: RoutineLoadRow;
}

export function toJob(row: RoutineLoadRow): RoutineLoadJob {
  const lag = parseJsonMap(row.OffsetLag);
  const lagNums = Object.values(lag).map(Number).filter(Number.isFinite);
  const tsProgress = parseJsonMap(row.TimestampProgress);
  const ts = Object.values(tsProgress).map(Number).filter((n) => Number.isFinite(n) && n > 1_000_000_000_000);
  const source = parseJsonMap(row.DataSourceProperties);
  const name = text(row.Name);
  const db = text(row.DbName);
  const id = text(row.Id);
  return {
    key: `${db}.${name}.${id}`,
    id,
    name,
    db,
    table: text(row.TableName),
    state: text(row.State).toUpperCase(),
    sourceType: text(row.DataSourceType) || 'KAFKA',
    job: parseJsonMap(row.JobProperties),
    source,
    custom: parseJsonMap(row.CustomProperties),
    stats: parseStats(row.Statistic),
    progress: parseJsonMap(row.Progress),
    latest: parseJsonMap(row.LatestSourcePosition),
    lag,
    tsProgress,
    totalLag: lagNums.length ? lagNums.reduce((s, n) => s + n, 0) : null,
    earliestTs: ts.length ? Math.min(...ts) : null,
    topic: source.topic || '',
    brokers: source.brokerList || '',
    reason: text(row.ReasonOfStateChanged),
    otherMsg: text(row.OtherMsg),
    errorLogUrls: text(row.ErrorLogUrls).split(/[,;\s]+/).filter((u) => u.startsWith('http')),
    raw: row,
  };
}

/** True when OtherMsg / the pause reason reads like a failure worth surfacing. */
export const looksLikeError = (msg: string) => /err|fail|exception|refused|timeout|unreachable|down/i.test(msg);

/** StarRocks records a user pause as "User <name> pauses routine load job". */
export const pausedByUser = (reason: string) => /user .* paus/i.test(reason);

/** Why a live job needs attention: a system pause or a failing task, else null. */
export function healthIssue(j: RoutineLoadJob): string | null {
  if (FINAL_STATES.has(j.state)) return null;
  if (j.state === 'PAUSED' && j.reason && !pausedByUser(j.reason)) return j.reason;
  if (j.otherMsg && looksLikeError(j.otherMsg)) return j.otherMsg;
  return null;
}

// ── SQL rendering ─────────────────────────────────────────────────────

export const quoteIdent = (s: string) => '`' + s.replace(/`/g, '') + '`';

/**
 * Single-quoted SQL string literal (MySQL escaping). Property values like
 * jsonpaths are JSON full of double quotes, which is why the old
 * `"jsonpaths" = "[...]"` rendering produced SQL that never parsed.
 */
export const sqlString = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

export const sqlProp = (k: string, v: string) => `  "${k}" = ${sqlString(v)}`;

/** Render `"k" = 'v'` pairs in key order — the backend renders ALTER the same way. */
export const propList = (props: Record<string, string>) =>
  Object.keys(props).sort().map((k) => sqlProp(k, props[k])).join(',\n');

/** SHOW ROUTINE LOAD JobProperties key → CREATE ROUTINE LOAD property. */
const JOB_PROPERTY_MAP: [string, string][] = [
  ['desireTaskConcurrentNum', 'desired_concurrent_number'],
  ['maxErrorNum', 'max_error_number'],
  ['maxFilterRatio', 'max_filter_ratio'],
  ['maxBatchIntervalS', 'max_batch_interval'],
  ['maxBatchRows', 'max_batch_rows'],
  ['maxBatchSize', 'max_batch_size'],
  ['taskConsumeSecond', 'task_consume_second'],
  ['taskTimeoutSecond', 'task_timeout_second'],
  ['format', 'format'],
  ['jsonpaths', 'jsonpaths'],
  ['json_root', 'json_root'],
  ['strip_outer_array', 'strip_outer_array'],
  ['strict_mode', 'strict_mode'],
  ['timezone', 'timezone'],
  ['pause_on_fatal_parse_error', 'pause_on_fatal_parse_error'],
  ['partial_update', 'partial_update'],
  ['partial_update_mode', 'partial_update_mode'],
  ['log_rejected_record_num', 'log_rejected_record_num'],
  ['trim_space', 'trim_space'],
  ['enclose', 'enclose'],
  ['escape', 'escape'],
];

/** Optional properties that are noise when empty / unset. */
const SKIP_WHEN_EMPTY = new Set(['jsonpaths', 'json_root', 'partial_update_mode', 'enclose', 'escape']);

/** "*" is how SHOW ROUTINE LOAD prints an absent COLUMNS / WHERE / PARTITION. */
const clauseValue = (v: string | undefined) => (v && v !== '*' && v !== 'null' ? v : '');

/**
 * CSV separators may already be printed quoted (`'\t'`). Backslashes are left
 * alone: `\t` / `\x01` are escape sequences the SQL lexer has to see.
 */
export const separator = (v: string) => (/^'.*'$/.test(v) ? v : "'" + v.replace(/'/g, "\\'") + "'");

/** Where a re-created job starts reading. */
export type OffsetMode = 'progress' | 'default' | 'beginning' | 'end';

/** Next offset to consume, from a Progress value (the last consumed offset). */
export function nextOffset(v: string): string {
  if (/^\d+$/.test(v)) return (BigInt(v) + 1n).toString();
  if (v === 'OFFSET_ZERO') return 'OFFSET_BEGINNING'; // nothing consumed yet
  return v; // OFFSET_BEGINNING / OFFSET_END
}

/**
 * Rebuild CREATE ROUTINE LOAD from a SHOW ROUTINE LOAD row. With `offsets:
 * 'progress'` the new job resumes exactly where this one stopped (pinned to the
 * partitions it has progress for) — re-reading from OFFSET_BEGINNING would
 * duplicate everything already loaded into a Duplicate Key table.
 */
export function buildCreateSQL(j: RoutineLoadJob, offsets: OffsetMode = 'progress'): string {
  const lines: string[] = [`CREATE ROUTINE LOAD ${quoteIdent(j.db)}.${quoteIdent(j.name)}`, `ON ${quoteIdent(j.table)}`];

  const load: string[] = [];
  if (j.job.columnSeparator) load.push(`COLUMNS TERMINATED BY ${separator(j.job.columnSeparator)}`);
  if (j.job.rowDelimiter) load.push(`ROWS TERMINATED BY ${separator(j.job.rowDelimiter)}`);
  const cols = clauseValue(j.job.columnToColumnExpr);
  if (cols) load.push(`COLUMNS(${cols})`);
  const where = clauseValue(j.job.whereExpr);
  if (where) load.push(`WHERE ${where}`);
  const parts = clauseValue(j.job.partitions);
  if (parts) load.push(`PARTITION(${parts})`);
  if (load.length) lines.push(load.join(',\n'));

  const props: string[] = [];
  for (const [showKey, sqlKey] of JOB_PROPERTY_MAP) {
    const v = j.job[showKey];
    if (v === undefined || v === 'null' || (v === '' && SKIP_WHEN_EMPTY.has(sqlKey))) continue;
    props.push(sqlProp(sqlKey, v));
  }
  if (props.length) lines.push('PROPERTIES (', props.join(',\n'), ')');

  const src: string[] = [sqlProp('kafka_broker_list', j.brokers), sqlProp('kafka_topic', j.topic)];
  const registry = j.source['confluent.schema.registry.url'];
  if (registry) src.push(sqlProp('confluent.schema.registry.url', registry));
  const partitions = sortedPartitions(j.progress);
  if (offsets === 'progress' && partitions.length) {
    src.push(sqlProp('kafka_partitions', partitions.join(',')));
    src.push(sqlProp('kafka_offsets', partitions.map((p) => nextOffset(j.progress[p])).join(',')));
  }
  const custom = { ...j.custom };
  if (offsets === 'beginning') custom.kafka_default_offsets = 'OFFSET_BEGINNING';
  if (offsets === 'end') custom.kafka_default_offsets = 'OFFSET_END';
  for (const k of Object.keys(custom).sort()) src.push(sqlProp(`property.${k}`, custom[k]));
  lines.push('FROM KAFKA (', src.join(',\n'), ');');

  return lines.join('\n');
}

/** Body of POST /api/routine-load/alter (only the fields being changed). */
export interface AlterChanges {
  columns?: string;
  where?: string;
  job_properties?: Record<string, string>;
  data_source_properties?: Record<string, string>;
}

/** Preview of what /api/routine-load/alter will run — mirrors buildAlterRoutineLoad in Go. */
export function buildAlterPreview(j: RoutineLoadJob, c: AlterChanges, resume: boolean): string {
  const target = `${quoteIdent(j.db)}.${quoteIdent(j.name)}`;
  const clauses: string[] = [];
  const load: string[] = [];
  if (c.columns?.trim()) load.push(`COLUMNS(${c.columns.trim()})`);
  if (c.where?.trim()) load.push(`WHERE ${c.where.trim()}`);
  if (load.length) clauses.push(load.join(',\n'));
  if (c.job_properties && Object.keys(c.job_properties).length) clauses.push(`PROPERTIES (\n${propList(c.job_properties)}\n)`);
  if (c.data_source_properties && Object.keys(c.data_source_properties).length) {
    clauses.push(`FROM KAFKA (\n${propList(c.data_source_properties)}\n)`);
  }
  if (!clauses.length) return '';
  const stmts: string[] = [];
  if (j.state !== 'PAUSED') stmts.push(`PAUSE ROUTINE LOAD FOR ${target};`);
  stmts.push(`ALTER ROUTINE LOAD FOR ${target}\n${clauses.join('\n')};`);
  if (resume) stmts.push(`RESUME ROUTINE LOAD FOR ${target};`);
  return stmts.join('\n\n');
}

/** Pull `db`.`job` out of a CREATE ROUTINE LOAD statement (backticks optional). */
export function parseCreateTarget(sql: string): { db: string; name: string } | null {
  const m = sql.match(/^\s*CREATE\s+ROUTINE\s+LOAD\s+(`[^`]+`|[\w$]+)\s*\.\s*(`[^`]+`|[\w$]+)/i);
  if (!m) return null;
  const strip = (s: string) => s.replace(/^`|`$/g, '');
  return { db: strip(m[1]), name: strip(m[2]) };
}

/** Normalize a broker list typed with spaces/semicolons into `h1:p,h2:p`. */
export const normalizeBrokers = (v: string) =>
  v.replace(/[;\s]+/g, ',').replace(/,{2,}/g, ',').replace(/^,|,$/g, '');

export const validBrokers = (v: string) =>
  !!v && v.split(',').every((b) => /^[^\s:,/]+:\d{1,5}$/.test(b));
