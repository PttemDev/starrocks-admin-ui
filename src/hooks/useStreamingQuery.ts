import { useCallback } from 'react';
import { Modal } from 'antd';
import { streamQuery } from '../api/client';
import { useQueryStore } from '../store/queryStore';
import { useEnvStore } from '../store/envStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useHistoryStore } from '../store/historyStore';
import type { StreamMetadata } from '../api/types';

/** Check if a SQL string already has a LIMIT clause (simple heuristic) */
function hasLimit(sql: string): boolean {
  const cleaned = sql
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return /\bLIMIT\s+\d/i.test(cleaned);
}

/**
 * Drop leading whitespace and comments so a prefix check sees the first real
 * keyword. Queries here routinely open with a `--` banner or a `/* ... *\/`
 * block, which used to make every one of them look like a write statement.
 */
function stripLeadingComments(sql: string): string {
  let s = sql.trim();
  for (;;) {
    if (s.startsWith('--') || s.startsWith('#')) {
      const nl = s.indexOf('\n');
      if (nl === -1) return '';
      s = s.slice(nl + 1).trim();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/', 2);
      if (end === -1) return '';
      s = s.slice(end + 2).trim();
    } else {
      return s;
    }
  }
}

/** Check if a SQL is a SELECT query (not SHOW, DESCRIBE, etc.) */
function isSelect(sql: string): boolean {
  const trimmed = stripLeadingComments(sql).toUpperCase();
  return trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');
}

/** Check if SQL is a read-only operation */
function isReadOnly(sql: string): boolean {
  const trimmed = stripLeadingComments(sql).toUpperCase();
  if (!trimmed) return true; // comments only — nothing to execute
  return (
    trimmed.startsWith('SELECT') ||
    trimmed.startsWith('WITH') ||
    trimmed.startsWith('SHOW') ||
    trimmed.startsWith('DESCRIBE') ||
    trimmed.startsWith('DESC') ||
    trimmed.startsWith('EXPLAIN') ||
    trimmed.startsWith('USE')
  );
}

/** Apply auto-limit to a SQL query if needed */
function applyAutoLimit(sql: string, limit: number): string {
  const trimmed = sql.trim();
  if (!isSelect(trimmed)) return trimmed;
  if (hasLimit(trimmed)) return trimmed;
  const base = trimmed.replace(/;\s*$/, '');
  return `${base}\nLIMIT ${limit}`;
}

export function useStreamingQuery() {
  const updateTab = useQueryStore((s) => s.updateTab);
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const settings = useSettingsStore((s) => s.query);
  const role = useAuthStore((s) => s.role);

  const runQuery = useCallback(
    async (tabId: string, sql: string) => {
      if (!selectedEnv) return;

      let finalSql = sql;
      let limitApplied = false;
      if (settings.autoLimit && settings.defaultLimit > 0) {
        const before = finalSql;
        finalSql = applyAutoLimit(finalSql, settings.defaultLimit);
        limitApplied = finalSql !== before;
      }

      const startTime = performance.now();
      updateTab(tabId, {
        loading: true,
        error: null,
        rows: [],
        columns: [],
        columnTypes: [],
        executionTimeMs: null,
        limitApplied,
      });

      try {
        const rows: Record<string, unknown>[] = [];
        let columns: string[] = [];
        let columnTypes: string[] = [];

        const sessionVars = Object.keys(settings.sessionVariables ?? {}).length > 0
          ? settings.sessionVariables
          : undefined;

        for await (const line of streamQuery(selectedEnv, finalSql, sessionVars)) {
          if ('type' in line) {
            if (line.type === 'metadata') {
              columns = (line as StreamMetadata).columns;
              columnTypes = (line as StreamMetadata).types ?? [];
              updateTab(tabId, { columns, columnTypes });
            } else if (line.type === 'error') {
              const errorMsg = (line as { error: string }).error;
              const elapsed = Math.round(performance.now() - startTime);
              updateTab(tabId, {
                error: errorMsg,
                loading: false,
                executionTimeMs: elapsed,
              });
              // Record error in history
              useHistoryStore.getState().addEntry({
                sql: finalSql,
                env: selectedEnv,
                timestamp: Date.now(),
                durationMs: elapsed,
                rowCount: null,
                columnCount: 0,
                status: 'error',
                error: errorMsg,
              });
              return;
            }
          } else {
            rows.push(line as Record<string, unknown>);
            if (rows.length % 500 === 0) {
              updateTab(tabId, { rows: [...rows] });
            }
          }
        }

        const displayRows =
          settings.maxDisplayRows > 0 && rows.length > settings.maxDisplayRows
            ? rows.slice(0, settings.maxDisplayRows)
            : rows;

        const elapsed = Math.round(performance.now() - startTime);

        updateTab(tabId, {
          rows: displayRows,
          columns,
          loading: false,
          executionTimeMs: elapsed,
          totalRowCount: rows.length,
        });

        // Record success in history
        useHistoryStore.getState().addEntry({
          sql: finalSql,
          env: selectedEnv,
          timestamp: Date.now(),
          durationMs: elapsed,
          rowCount: rows.length,
          columnCount: columns.length,
          status: 'success',
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const elapsed = Math.round(performance.now() - startTime);
        updateTab(tabId, {
          error: errorMsg,
          loading: false,
          executionTimeMs: elapsed,
        });
        // Record error in history
        useHistoryStore.getState().addEntry({
          sql: finalSql,
          env: selectedEnv,
          timestamp: Date.now(),
          durationMs: elapsed,
          rowCount: null,
          columnCount: 0,
          status: 'error',
          error: errorMsg,
        });
      }
    },
    [selectedEnv, updateTab, settings.autoLimit, settings.defaultLimit, settings.maxDisplayRows, settings.sessionVariables],
  );

  const execute = useCallback(
    (tabId: string, sql: string) => {
      if (!sql.trim()) return;

      // Viewer: block write queries
      if (role !== 'admin' && !isReadOnly(sql)) {
        updateTab(tabId, {
          error: 'Write operations (ALTER, CREATE, DROP, INSERT, UPDATE, DELETE) are not allowed for view-only users. Contact an admin.',
          loading: false,
        });
        return;
      }

      // Admin: confirm write queries
      if (role === 'admin' && !isReadOnly(sql)) {
        Modal.confirm({
          title: 'Execute write query?',
          // Show the statement, not the comment banner in front of it.
          content: `This query will modify data or schema:\n\n${stripLeadingComments(sql).slice(0, 300)}`,
          okText: 'Execute',
          okType: 'danger',
          onOk: () => runQuery(tabId, sql),
        });
        return;
      }

      // Read-only query — execute directly
      runQuery(tabId, sql);
    },
    [role, runQuery, updateTab],
  );

  return { execute };
}
