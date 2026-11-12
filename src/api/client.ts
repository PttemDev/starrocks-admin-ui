import { useAuthStore } from '../store/authStore';
import type { Environment, StreamLine, NodeGroup, ExportRequest, ColumnInfo, RoutineLoadExecResult, RoutineLoadAlterRequest, RoutineLoadAlterResult, TableDetail, AdminExecResult } from './types';

const BASE = (import.meta.env.VITE_API_URL || '') + '/api';

function headers(env?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = useAuthStore.getState().token;
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (env) h['X-Environment'] = env;
  return h;
}

export async function login(username: string, password: string): Promise<{ token: string; role: 'admin' | 'viewer' }> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  const data = await res.json();
  return { token: data.token, role: data.role || 'viewer' };
}

export async function fetchEnvironments(): Promise<Environment[]> {
  const res = await fetch(`${BASE}/environments`, { headers: headers() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function* streamQuery(
  env: string,
  sql: string,
  sessionVariables?: Record<string, string>,
): AsyncGenerator<StreamLine> {
  const body: Record<string, unknown> = { sql };
  if (sessionVariables && Object.keys(sessionVariables).length > 0) {
    body.session_variables = sessionVariables;
  }
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed);
      } catch {
        // skip malformed lines
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim());
    } catch {
      // skip
    }
  }
}

// Buffered query — runs SQL and returns the full result set at once.
// Used for data preview and schema inference (SELECT ... FROM FILES / DESC FILES).
export interface QueryResult {
  columns: string[];
  types: string[];
  rows: Record<string, unknown>[];
}

export async function runQuery(env: string, sql: string): Promise<QueryResult> {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql, format: 'json' }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function fetchNodes(env: string): Promise<NodeGroup[]> {
  const res = await fetch(`${BASE}/nodes`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchIngestion(env: string, db?: string): Promise<Record<string, unknown>[]> {
  const params = db ? `?db=${encodeURIComponent(db)}` : '';
  const res = await fetch(`${BASE}/ingestion${params}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRoutines(env: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/routines`, { headers: headers(env) });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function fetchDatabases(env: string): Promise<string[]> {
  const res = await fetch(`${BASE}/databases`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTables(env: string, db: string): Promise<string[]> {
  const res = await fetch(`${BASE}/tables?db=${encodeURIComponent(db)}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchColumns(env: string, db: string, table: string): Promise<ColumnInfo[]> {
  const res = await fetch(
    `${BASE}/columns?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`,
    { headers: headers(env) },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRoutineLoadsForDB(
  env: string,
  db: string,
  table?: string,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ db });
  if (table) params.set('table', table);
  const res = await fetch(`${BASE}/routine-load/list?${params}`, { headers: headers(env) });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function executeRoutineLoadCommand(
  env: string,
  sql: string,
): Promise<RoutineLoadExecResult> {
  const res = await fetch(`${BASE}/routine-load/execute`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

/** PAUSE (if active) → ALTER → RESUME in one call; the server rolls back a failed ALTER. */
export async function alterRoutineLoad(env: string, req: RoutineLoadAlterRequest): Promise<RoutineLoadAlterResult> {
  const res = await fetch(`${BASE}/routine-load/alter`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(req),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function fetchTableDetails(env: string, db: string): Promise<TableDetail[]> {
  const res = await fetch(`${BASE}/table-details?db=${encodeURIComponent(db)}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addColumn(
  env: string,
  database: string,
  table: string,
  sql: string,
): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/add-column`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, table, sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

export async function createTable(env: string, sql: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/create-table`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

export async function adminExec(env: string, sql: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/admin/exec`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

export async function fetchShowCreate(env: string, db: string, table: string, type: string): Promise<{ name: string; type: string; ddl: string }> {
  const params = new URLSearchParams({ db, table, type });
  const res = await fetch(`${BASE}/show-create?${params}`, { headers: headers(env) });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

export async function fetchProcessList(env: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/process-list`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchCurrentQueries(env: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/current-queries`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSlowQueries(env: string, limit = 100): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/slow-queries?limit=${limit}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function killQuery(env: string, connectionId: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/kill-query`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ connection_id: connectionId }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

export async function fetchBatchLoadJobs(env: string, db?: string, limit = 50): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (db) params.set('db', db);
  const res = await fetch(`${BASE}/batch-load/list?${params}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function executeBatchLoad(env: string, sql: string, database?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/batch-load/execute`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql, database }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

export async function cancelBatchLoad(env: string, database: string, label: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/batch-load/cancel`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, label }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || text);
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text);
      throw e;
    }
  }
  return res.json();
}

// ── Scheduled tasks (StarRocks SUBMIT TASK ... SCHEDULE) ──────────────

function parseError(text: string): Error {
  try {
    const err = JSON.parse(text);
    return new Error(err.error || text);
  } catch (e) {
    if (e instanceof SyntaxError) return new Error(text);
    throw e;
  }
}

export async function fetchScheduledTasks(env: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/scheduled-tasks`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTaskRuns(env: string, task: string, limit = 50): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ task, limit: String(limit) });
  const res = await fetch(`${BASE}/scheduled-tasks/runs?${params}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createScheduledTask(env: string, sql: string, database?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/scheduled-tasks`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql, database }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function updateScheduledTask(env: string, name: string, sql: string, database?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/scheduled-tasks/update`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ name, sql, database }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function triggerScheduledTask(env: string, name: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/scheduled-tasks/trigger`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function dropScheduledTask(env: string, name: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/scheduled-tasks/drop`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

// ── Pipes (StarRocks CREATE PIPE — continuous incremental ingestion) ──

export async function fetchPipes(env: string, db?: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams();
  if (db) params.set('db', db);
  const qs = params.toString();
  const res = await fetch(`${BASE}/pipes${qs ? `?${qs}` : ''}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchPipeFiles(env: string, pipe: string, db?: string, limit = 100): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ pipe, limit: String(limit) });
  if (db) params.set('db', db);
  const res = await fetch(`${BASE}/pipes/files?${params}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createPipe(env: string, sql: string, database?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/pipes`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql, database }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function alterPipe(env: string, database: string, name: string, action: 'suspend' | 'resume'): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/pipes/alter`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, name, action }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function setPipeProperty(env: string, database: string, name: string, properties: Record<string, string>): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/pipes/set`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, name, properties }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function retryPipe(env: string, database: string, name: string, file?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/pipes/retry`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, name, file }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function dropPipe(env: string, database: string, name: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/pipes/drop`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, name }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

// ── Materialized views ───────────────────────────────────────────────

export async function fetchMaterializedViews(env: string, db?: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams();
  if (db) params.set('db', db);
  const qs = params.toString();
  const res = await fetch(`${BASE}/materialized-views${qs ? `?${qs}` : ''}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createMaterializedView(env: string, sql: string, database?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/materialized-views`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql, database }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function refreshMaterializedView(env: string, database: string, name: string, force = false): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/materialized-views/refresh`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, name, force }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export async function dropMaterializedView(env: string, database: string, name: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/materialized-views/drop`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ database, name }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

// ── Partitions ────────────────────────────────────────────────────────

export async function fetchPartitions(env: string, db: string, table: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ db, table });
  const res = await fetch(`${BASE}/partitions?${params}`, { headers: headers(env) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function execPartition(env: string, sql: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/partitions/exec`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

// ── Export to object storage (INSERT INTO FILES) ──────────────────────

export async function exportToFiles(env: string, sql: string, database?: string): Promise<AdminExecResult> {
  const res = await fetch(`${BASE}/export-files`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ sql, database }),
  });
  if (!res.ok) throw parseError(await res.text());
  return res.json();
}

export function streamLoad(
  env: string,
  database: string,
  table: string,
  file: File,
  options?: {
    format?: string;
    column_separator?: string;
    enclose?: string;
    escape?: string;
    columns?: string;
    label?: string;
    max_filter_ratio?: string;
    strict_mode?: string;
    timezone?: string;
    jsonpaths?: string;
    json_root?: string;
    strip_outer_array?: string;
    skip_header?: string;
  },
  onProgress?: (percent: number) => void,
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('database', database);
  formData.append('table', table);
  formData.append('file', file);
  if (options) {
    for (const [k, v] of Object.entries(options)) {
      if (v) formData.append(k, v);
    }
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/stream-load`);

    const token = useAuthStore.getState().token;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (env) xhr.setRequestHeader('X-Environment', env);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error(xhr.responseText || `Stream load failed with status ${xhr.status}`));
        return;
      }
      if (xhr.status >= 400) {
        reject(new Error(String(parsed.error || parsed.Message || parsed.msg || xhr.responseText)));
        return;
      }
      resolve(parsed);
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };

    xhr.send(formData);
  });
}

/**
 * Runs the export and hands the browser the resulting file. Resolves only once
 * the download has been triggered, so callers can keep their button busy for
 * the whole round trip — a large export takes a while and re-firing it runs the
 * query on the cluster again.
 */
export async function exportData(
  env: string,
  req: ExportRequest & { session_variables?: Record<string, string> },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="(.+)"/);
  a.download = match?.[1] || `export.${req.format === 'excel' ? 'xlsx' : req.format}`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
