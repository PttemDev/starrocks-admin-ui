import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeAlpine,
  type CellContextMenuEvent,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type SelectionChangedEvent,
} from 'ag-grid-community';
import { Dropdown, message, Input, Tooltip } from 'antd';
import type { InputRef } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import {
  SearchOutlined,
  CloseOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import JsonViewerModal from './JsonViewerModal';
import { useTheme } from '../../hooks/useTheme';

ModuleRegistry.registerModules([AllCommunityModule]);

// The v33+ Theming API styles the grid from JS, so these belong here rather
// than in a `.ag-theme-alpine` stylesheet block — that class is never applied.
const GRID_PARAMS = { borderRadius: 8, fontSize: 13 };
const GRID_THEME_LIGHT = themeAlpine.withParams({
  ...GRID_PARAMS,
  rowBorder: { color: 'var(--sr-border-subtle)' },
  headerBackgroundColor: 'var(--sr-card-alt)',
  headerTextColor: 'var(--sr-text-secondary)',
});
const GRID_THEME_DARK = themeAlpine.withPart(colorSchemeDark).withParams({
  ...GRID_PARAMS,
  backgroundColor: '#161b22',
  headerBackgroundColor: '#1c2129',
  rowBorder: { color: '#21262d' },
});

// ─── Types ────────────────────────────────────────────────────

interface Props {
  columns: string[];
  columnTypes: string[];
  rows: Record<string, unknown>[];
}

interface ColumnStats {
  isNumeric: boolean;
  min: number;
  max: number;
  sum: number;
  count: number;
  nullCount: number;
  distinctCount: number;
  avg: number;
}

// ─── Constants ────────────────────────────────────────────────

const NUMERIC_TYPES = new Set([
  'TINYINT', 'SMALLINT', 'INT', 'INTEGER', 'BIGINT', 'LARGEINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'DECIMALV2', 'DECIMALV3',
  'DECIMAL32', 'DECIMAL64', 'DECIMAL128', 'NUMBER',
]);

interface ChipStyle { bg: string; color: string; border: string }

/** Chip palettes read from CSS variables so they follow the active theme. */
const chip = (name: string): ChipStyle => ({
  bg: `var(--sr-${name}-bg)`,
  color: `var(--sr-${name}-fg)`,
  border: `var(--sr-${name}-border)`,
});
const OK = chip('ok');
const ERR = chip('err');
const WARN = chip('warn');
const NEUTRAL = chip('neutral');

const STATUS_STYLES: Record<string, ChipStyle> = {
  // Green - positive
  APPROVED:  OK,
  SUCCESS:   OK,
  ACTIVE:    OK,
  ENABLED:   OK,
  RUNNING:   OK,
  COMPLETED: OK,
  DONE:      OK,
  FINISHED:  OK,
  TRUE:      OK,
  YES:       OK,
  UP:        OK,
  ALIVE:     OK,
  OK:        OK,
  ONLINE:    OK,
  HEALTHY:   OK,
  // Red - negative
  REJECTED:  ERR,
  FAILED:    ERR,
  FAILURE:   ERR,
  ERROR:     ERR,
  INACTIVE:  ERR,
  DISABLED:  ERR,
  FALSE:     ERR,
  NO:        ERR,
  DOWN:      ERR,
  DEAD:      ERR,
  OFFLINE:   ERR,
  DROPPED:   ERR,
  UNHEALTHY: ERR,
  // Orange - warning/pending
  PENDING:    WARN,
  WAITING:    WARN,
  QUEUED:     WARN,
  PROCESSING: WARN,
  WARNING:    WARN,
  UNKNOWN:    WARN,
  RETRYING:   WARN,
  // Gray - neutral/stopped
  CANCELLED: NEUTRAL,
  CANCELED:  NEUTRAL,
  PAUSED:    NEUTRAL,
  STOPPED:   NEUTRAL,
  SUSPENDED: NEUTRAL,
};

// ─── Column Sizing ────────────────────────────────────────────
// Widths are encoded as minWidth (not width) so sizeColumnsToFit can only
// grow them: with few columns they spread to fill the pane, with many they
// stay at their content width and the grid scrolls horizontally.

/** Approximate advance width of one character at the grid's 13px font. */
const CHAR_PX = 7.5;
const CELL_CHROME_PX = 34;
/** Header also carries sort + filter icons. */
const HEADER_CHROME_PX = 52;
const MIN_COL_WIDTH = 120;
const MAX_COL_WIDTH = 360;
const WIDTH_SAMPLE_ROWS = 50;

function estimateColWidth(
  col: string,
  rows: Record<string, unknown>[],
  isJson: boolean,
): number {
  let dataChars = 0;
  const sample = Math.min(rows.length, WIDTH_SAMPLE_ROWS);
  for (let i = 0; i < sample; i++) {
    const val = rows[i]?.[col];
    if (val === null || val === undefined) continue;
    const len =
      typeof val === 'string' ? val.length : String(val).length;
    if (len > dataChars) dataChars = len;
  }
  const px = Math.max(
    col.length * CHAR_PX + HEADER_CHROME_PX,
    dataChars * CHAR_PX + CELL_CHROME_PX,
  );
  return Math.max(
    isJson ? 200 : MIN_COL_WIDTH,
    Math.min(MAX_COL_WIDTH, Math.round(px)),
  );
}

// ─── Utility Functions ────────────────────────────────────────

function isNumericType(type: string): boolean {
  const base = type.toUpperCase().replace(/\(.*\)/, '').trim();
  return NUMERIC_TYPES.has(base);
}

function isJsonType(type: string): boolean {
  const upper = type.toUpperCase();
  return upper === 'JSON' || upper === 'JSONB';
}

function looksLikeJson(value: unknown): boolean {
  if (typeof value === 'object' && value !== null) return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try { JSON.parse(trimmed); return true; } catch { return false; }
  }
  return false;
}

function getStatusStyle(value: unknown): ChipStyle | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim().toUpperCase().replace(/[\s-]/g, '_');
  return STATUS_STYLES[str] ?? null;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return `'${json.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function copyToClipboard(text: string, label?: string) {
  navigator.clipboard.writeText(text);
  message.success(`${label ?? 'Copied'}`);
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function computeColumnStats(
  rows: Record<string, unknown>[],
  columns: string[],
  typeMap: Record<string, string>,
): Record<string, ColumnStats> {
  const stats: Record<string, ColumnStats> = {};

  for (const col of columns) {
    const colType = typeMap[col] ?? '';
    const isNum = isNumericType(colType);
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    let nullCount = 0;
    const distinct = new Set<string>();

    for (const row of rows) {
      const val = row[col];
      if (val === null || val === undefined) { nullCount++; continue; }
      count++;
      distinct.add(String(val));
      if (isNum) {
        const num = Number(val);
        if (!isNaN(num)) {
          if (num < min) min = num;
          if (num > max) max = num;
          sum += num;
        }
      }
    }

    stats[col] = {
      isNumeric: isNum,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      sum,
      count,
      nullCount,
      distinctCount: distinct.size,
      avg: count > 0 ? sum / count : 0,
    };
  }
  return stats;
}

function highlightMatch(text: string, term: string) {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#ffd54f', color: '#1f2328', padding: '1px 0', borderRadius: 2 }}>
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────

export default function ResultTable({ columns, columnTypes, rows }: Props) {
  const { isDark } = useTheme();
  const gridApiRef = useRef<GridApi | null>(null);
  const searchInputRef = useRef<InputRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [jsonModal, setJsonModal] = useState<{ title: string; value: string } | null>(null);
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number; items: ItemType[] } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number; items: ItemType[] } | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCount, setSelectedCount] = useState(0);

  // Refs for values the cell renderer reads (avoids recreating the renderer callback)
  const searchTermRef = useRef('');
  const columnStatsRef = useRef<Record<string, ColumnStats>>({});

  // Type lookup
  const typeMap = useMemo(() => {
    const map: Record<string, string> = {};
    columns.forEach((col, i) => { if (columnTypes[i]) map[col] = columnTypes[i]; });
    return map;
  }, [columns, columnTypes]);

  // Column statistics
  const columnStats = useMemo(
    () => computeColumnStats(rows, columns, typeMap),
    [rows, columns, typeMap],
  );
  columnStatsRef.current = columnStats;

  // Summary row (pinned bottom)
  const summaryRowData = useMemo(() => {
    if (rows.length === 0) return [];
    const summary: Record<string, unknown> = { __isSummary: true };
    for (const col of columns) summary[col] = columnStats[col];
    return [summary];
  }, [rows, columns, columnStats]);

  // Search match count
  const matchCount = useMemo(() => {
    if (!searchTerm) return 0;
    const term = searchTerm.toLowerCase();
    let count = 0;
    for (const row of rows) {
      for (const col of columns) {
        const val = row[col];
        if (val != null && String(val).toLowerCase().includes(term)) count++;
      }
    }
    return count;
  }, [rows, columns, searchTerm]);

  // Sync search to ref & refresh cells
  useEffect(() => {
    searchTermRef.current = searchTerm;
    gridApiRef.current?.refreshCells({ force: true });
  }, [searchTerm]);

  // Ctrl+F / Escape keyboard shortcut
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setSearchTerm('');
        searchTermRef.current = '';
        gridApiRef.current?.refreshCells({ force: true });
      }
    };
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openJsonModal = useCallback((title: string, value: string) => {
    gridApiRef.current?.clearFocusedCell();
    setJsonModal({ title, value });
  }, []);

  // ─── Cell Renderer ─────────────────────────────────────────

  const SmartCellRenderer = useCallback(
    (params: ICellRendererParams) => {
      // --- Summary row (pinned bottom) ---
      if (params.node?.rowPinned === 'bottom') {
        const field = params.colDef?.field;
        if (!field) {
          return <span style={{ fontWeight: 600, color: 'var(--sr-text-secondary)', fontSize: 11 }}>&#931;</span>;
        }
        const stats = params.value as ColumnStats | undefined;
        if (!stats || typeof stats !== 'object' || !('isNumeric' in stats)) return null;

        if (stats.isNumeric) {
          return (
            <Tooltip
              title={
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>Sum: {formatNumber(stats.sum)}</div>
                  <div>Avg: {formatNumber(stats.avg)}</div>
                  <div>Min: {formatNumber(stats.min)}</div>
                  <div>Max: {formatNumber(stats.max)}</div>
                  <div>Count: {stats.count.toLocaleString()}</div>
                  <div>Nulls: {stats.nullCount.toLocaleString()}</div>
                </div>
              }
            >
              <span style={{ fontWeight: 500, color: '#1677ff', fontSize: 12, cursor: 'default' }}>
                &Sigma; {formatNumber(stats.sum)} &middot; &mu; {formatNumber(stats.avg)}
              </span>
            </Tooltip>
          );
        }
        return (
          <Tooltip
            title={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>Distinct: {stats.distinctCount.toLocaleString()}</div>
                <div>Count: {stats.count.toLocaleString()}</div>
                <div>Nulls: {stats.nullCount.toLocaleString()}</div>
              </div>
            }
          >
            <span style={{ fontWeight: 500, color: 'var(--sr-text-secondary)', fontSize: 12, cursor: 'default' }}>
              &#9671; {stats.distinctCount} distinct
            </span>
          </Tooltip>
        );
      }

      // --- Regular data cells ---
      const raw = params.value;
      const colName = params.colDef?.field ?? '';
      const colType = typeMap[colName] ?? '';
      const search = searchTermRef.current;

      // NULL
      if (raw === null || raw === undefined) {
        return (
          <span style={{
            color: 'var(--sr-text-muted)',
            fontStyle: 'italic',
            background: 'var(--sr-card-alt)',
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 12,
          }}>
            NULL
          </span>
        );
      }

      // JSON
      const isJson = isJsonType(colType) || looksLikeJson(raw);
      if (isJson) {
        const display = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
        const truncated = display.length > 80 ? display.slice(0, 80) + '...' : display;
        return (
          <span
            style={{
              cursor: 'pointer',
              color: '#1677ff',
              textDecoration: 'underline dotted',
              textUnderlineOffset: 3,
            }}
            title="Click to view JSON"
            onClick={() => {
              const strValue = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
              openJsonModal(colName, strValue);
            }}
          >
            {search ? highlightMatch(truncated, search) : truncated}
          </span>
        );
      }

      const strVal = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);

      // Status badge
      const statusStyle = getStatusStyle(raw);
      if (statusStyle) {
        return (
          <span style={{
            background: statusStyle.bg,
            color: statusStyle.color,
            border: `1px solid ${statusStyle.border}`,
            borderRadius: 4,
            padding: '1px 8px',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: '20px',
            display: 'inline-block',
          }}>
            {search ? highlightMatch(strVal, search) : strVal}
          </span>
        );
      }

      // Numeric data bar
      const stats = columnStatsRef.current[colName];
      if (stats?.isNumeric) {
        const num = Number(raw);
        if (!isNaN(num)) {
          const range = stats.max - stats.min;
          const ratio = range > 0 ? (num - stats.min) / range : 0;
          return (
            <div style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
            }}>
              <div style={{
                position: 'absolute',
                left: 0,
                top: 3,
                bottom: 3,
                width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
                background: 'rgba(59, 130, 246, 0.10)',
                borderRadius: 2,
              }} />
              <span style={{ position: 'relative', zIndex: 1 }}>
                {search ? highlightMatch(strVal, search) : strVal}
              </span>
            </div>
          );
        }
      }

      // Default
      return <span>{search ? highlightMatch(strVal, search) : strVal}</span>;
    },
    [typeMap, openJsonModal],
  );

  // ─── Column Definitions ────────────────────────────────────

  const sampleSize = Math.min(rows.length, WIDTH_SAMPLE_ROWS);

  const columnDefs = useMemo<ColDef[]>(() => {
    const defs: ColDef[] = [
      {
        headerName: '#',
        valueGetter: (params) => {
          if (params.node?.rowPinned === 'bottom') return '';
          return params.node ? params.node.rowIndex! + 1 : '';
        },
        width: 60,
        minWidth: 50,
        maxWidth: 80,
        pinned: 'left',
        sortable: false,
        filter: false,
        resizable: false,
        suppressHeaderMenuButton: true,
        cellRenderer: SmartCellRenderer,
        cellStyle: (params) => {
          if (params.node?.rowPinned === 'bottom') {
            return { background: 'var(--sr-card-alt)', fontWeight: 600, textAlign: 'center' } as Record<string, string | number>;
          }
          return { color: 'var(--sr-text-muted)', fontSize: '12px', textAlign: 'right', paddingRight: '8px' };
        },
      },
    ];

    for (const col of columns) {
      const colType = typeMap[col] ?? '';
      const isJson = isJsonType(colType);

      const def: ColDef = {
        field: col,
        headerName: col,
        sortable: true,
        filter: true,
        resizable: true,
        unSortIcon: true,
        cellRenderer: SmartCellRenderer,
        cellStyle: (params) => {
          if (params.node?.rowPinned === 'bottom') {
            return { background: 'var(--sr-card-alt)', borderTop: '2px solid #e2e8f0' };
          }
          return undefined;
        },
      };

      def.minWidth = estimateColWidth(col, rows, isJson);
      defs.push(def);
    }
    return defs;
    // `sampleSize` (not `rows`) keeps the defs stable while rows stream in —
    // rebuilding columnDefs on every chunk would reset the grid's columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, typeMap, SmartCellRenderer, sampleSize]);

  // ─── Selection ─────────────────────────────────────────────

  const handleSelectionChanged = useCallback((event: SelectionChangedEvent) => {
    setSelectedCount(event.api.getSelectedRows().length);
  }, []);

  const handleCopySelected = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const selectedRows = api.getSelectedRows();
    if (selectedRows.length === 0) return;
    const headers = columns.join('\t');
    const lines = selectedRows.map((row) =>
      columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      }).join('\t'),
    );
    copyToClipboard([headers, ...lines].join('\n'), `${selectedRows.length} rows copied`);
  }, [columns]);

  const handleCopySelectedJson = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const selectedRows = api.getSelectedRows();
    if (selectedRows.length === 0) return;
    copyToClipboard(JSON.stringify(selectedRows, null, 2), `${selectedRows.length} rows copied as JSON`);
  }, []);

  // ─── Context Menus ─────────────────────────────────────────

  const handleCellContextMenu = useCallback(
    (event: CellContextMenuEvent) => {
      const e = event.event as MouseEvent;
      if (!e || !event.colDef?.field) return;
      e.preventDefault();

      const col = event.colDef.field;
      const value = event.value;
      const rowData = event.data;
      const displayVal = formatCellValue(value);
      const sqlLiteral = toSqlLiteral(value);
      const colType = typeMap[col] ?? '';
      const isJson = isJsonType(colType);

      const items: ItemType[] = [
        {
          key: 'copy-value',
          label: 'Copy value',
          onClick: () => copyToClipboard(displayVal, 'Value copied'),
        },
        {
          key: 'copy-sql-literal',
          label: 'Copy as SQL literal',
          onClick: () => copyToClipboard(sqlLiteral, 'SQL literal copied'),
        },
        { type: 'divider' },
        {
          key: 'copy-where',
          label: `WHERE ${col} = ${sqlLiteral.length > 30 ? sqlLiteral.slice(0, 30) + '...' : sqlLiteral}`,
          onClick: () =>
            copyToClipboard(
              value === null || value === undefined
                ? `WHERE ${col} IS NULL`
                : `WHERE ${col} = ${sqlLiteral}`,
              'WHERE clause copied',
            ),
        },
        {
          key: 'copy-and',
          label: `AND ${col} = ${sqlLiteral.length > 30 ? sqlLiteral.slice(0, 30) + '...' : sqlLiteral}`,
          onClick: () =>
            copyToClipboard(
              value === null || value === undefined
                ? `AND ${col} IS NULL`
                : `AND ${col} = ${sqlLiteral}`,
              'AND clause copied',
            ),
        },
      ];

      if ((isJson || looksLikeJson(value)) && value !== null && value !== undefined) {
        items.push(
          { type: 'divider' },
          {
            key: 'view-json',
            label: 'View JSON',
            onClick: () => {
              const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
              openJsonModal(col, strValue);
            },
          },
        );
      }

      items.push(
        { type: 'divider' },
        {
          key: 'copy-row-json',
          label: 'Copy row as JSON',
          onClick: () => copyToClipboard(JSON.stringify(rowData, null, 2), 'Row copied as JSON'),
        },
      );

      setCellMenu({ x: e.clientX, y: e.clientY, items });
    },
    [typeMap, openJsonModal],
  );

  const handleHeaderContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const headerCell = target.closest('.ag-header-cell');
      if (!headerCell) return;

      const colId = headerCell.getAttribute('col-id');
      if (!colId || colId === '0') return;

      e.preventDefault();
      e.stopPropagation();

      const api = gridApiRef.current;

      const items: ItemType[] = [
        {
          key: 'copy-col-name',
          label: 'Copy column name',
          onClick: () => copyToClipboard(colId, 'Column name copied'),
        },
        { type: 'divider' },
        {
          key: 'pin-left',
          label: 'Pin left',
          onClick: () => api?.applyColumnState({ state: [{ colId, pinned: 'left' }] }),
        },
        {
          key: 'pin-right',
          label: 'Pin right',
          onClick: () => api?.applyColumnState({ state: [{ colId, pinned: 'right' }] }),
        },
        {
          key: 'unpin',
          label: 'Unpin',
          onClick: () => api?.applyColumnState({ state: [{ colId, pinned: null }] }),
        },
        { type: 'divider' },
        {
          key: 'copy-where-col',
          label: `Copy: WHERE ${colId} = ''`,
          onClick: () => copyToClipboard(`WHERE ${colId} = ''`, 'WHERE clause copied'),
        },
        {
          key: 'copy-and-col',
          label: `Copy: AND ${colId} = ''`,
          onClick: () => copyToClipboard(`AND ${colId} = ''`, 'AND clause copied'),
        },
        {
          key: 'copy-where-null',
          label: `Copy: WHERE ${colId} IS NULL`,
          onClick: () => copyToClipboard(`WHERE ${colId} IS NULL`, 'WHERE IS NULL copied'),
        },
        {
          key: 'copy-where-not-null',
          label: `Copy: WHERE ${colId} IS NOT NULL`,
          onClick: () => copyToClipboard(`WHERE ${colId} IS NOT NULL`, 'WHERE IS NOT NULL copied'),
        },
        { type: 'divider' },
        {
          key: 'copy-select',
          label: `Copy: SELECT ${colId}`,
          onClick: () => copyToClipboard(`SELECT ${colId}`, 'SELECT copied'),
        },
        {
          key: 'copy-group-by',
          label: `Copy: GROUP BY ${colId}`,
          onClick: () => copyToClipboard(`GROUP BY ${colId}`, 'GROUP BY copied'),
        },
        {
          key: 'copy-order-by',
          label: `Copy: ORDER BY ${colId}`,
          onClick: () => copyToClipboard(`ORDER BY ${colId}`, 'ORDER BY copied'),
        },
      ];

      setHeaderMenu({ x: e.clientX, y: e.clientY, items });
    },
    [],
  );

  if (columns.length === 0) return null;

  const showToolbar = showSearch || selectedCount > 0;

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={-1}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 200, outline: 'none' }}
      >
        {/* Feature toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: showToolbar ? '6px 10px' : '4px 10px',
          background: 'var(--sr-card-alt)',
          borderRadius: '8px 8px 0 0',
          border: '1px solid #e2e8f0',
          borderBottom: 'none',
          fontSize: 13,
          minHeight: 28,
        }}>
          {showSearch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <SearchOutlined style={{ color: 'var(--sr-text-secondary)' }} />
              <Input
                ref={searchInputRef}
                placeholder="Search in results..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowSearch(false);
                    setSearchTerm('');
                    searchTermRef.current = '';
                    gridApiRef.current?.refreshCells({ force: true });
                  }
                }}
                size="small"
                style={{ maxWidth: 260 }}
                allowClear
                autoFocus
              />
              {searchTerm && (
                <span style={{ color: 'var(--sr-text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {matchCount} {matchCount === 1 ? 'match' : 'matches'}
                </span>
              )}
              <CloseOutlined
                style={{ color: 'var(--sr-text-secondary)', cursor: 'pointer', fontSize: 12 }}
                onClick={() => {
                  setShowSearch(false);
                  setSearchTerm('');
                  searchTermRef.current = '';
                  gridApiRef.current?.refreshCells({ force: true });
                }}
              />
            </div>
          ) : (
            <Tooltip title="Search (Ctrl+F)">
              <SearchOutlined
                style={{ color: 'var(--sr-text-faint)', cursor: 'pointer', fontSize: 14 }}
                onClick={() => {
                  setShowSearch(true);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
              />
            </Tooltip>
          )}

          {/* Separator */}
          {showSearch && selectedCount > 0 && (
            <div style={{ width: 1, height: 20, background: 'var(--sr-border)' }} />
          )}

          {/* Selected rows actions */}
          {selectedCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span style={{ color: 'var(--sr-text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                {selectedCount} row{selectedCount !== 1 ? 's' : ''} selected
              </span>
              <Tooltip title="Copy as tab-separated">
                <span
                  style={{ color: '#1677ff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}
                  onClick={handleCopySelected}
                >
                  <CopyOutlined /> Copy
                </span>
              </Tooltip>
              <Tooltip title="Copy as JSON">
                <span
                  style={{ color: '#1677ff', cursor: 'pointer', fontSize: 12 }}
                  onClick={handleCopySelectedJson}
                >
                  JSON
                </span>
              </Tooltip>
            </div>
          )}
        </div>

        {/* AG Grid */}
        <div
          onContextMenu={handleHeaderContextMenu}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 200,
            width: '100%',
            borderRadius: '0 0 8px 8px',
            overflow: 'hidden',
            border: '1px solid #e2e8f0',
          }}
        >
          <AgGridReact
            theme={isDark ? GRID_THEME_DARK : GRID_THEME_LIGHT}
            columnDefs={columnDefs}
            rowData={rows}
            defaultColDef={{ minWidth: MIN_COL_WIDTH, resizable: true }}
            animateRows={false}
            pagination={true}
            paginationPageSize={100}
            paginationPageSizeSelector={[50, 100, 500]}
            enableCellTextSelection={true}
            ensureDomOrder={true}
            suppressCellFocus={false}
            rowSelection={{ mode: 'multiRow', enableClickSelection: false }}
            selectionColumnDef={{
              pinned: 'left',
              width: 40,
              minWidth: 40,
              maxWidth: 40,
              suppressHeaderMenuButton: true,
            }}
            onSelectionChanged={handleSelectionChanged}
            pinnedBottomRowData={summaryRowData}
            onGridReady={(e) => { gridApiRef.current = e.api; e.api.sizeColumnsToFit(); }}
            onGridColumnsChanged={(e) => e.api.sizeColumnsToFit()}
            onFirstDataRendered={(e) => e.api.sizeColumnsToFit()}
            onCellContextMenu={handleCellContextMenu}
            preventDefaultOnContextMenu={true}
          />
        </div>
      </div>

      {/* JSON Viewer Modal */}
      {jsonModal && (
        <JsonViewerModal
          open={true}
          title={jsonModal.title}
          value={jsonModal.value}
          onClose={() => setJsonModal(null)}
        />
      )}

      {/* Cell Context Menu */}
      {cellMenu && (
        <Dropdown
          open={true}
          menu={{ items: cellMenu.items, onClick: () => setCellMenu(null) }}
          onOpenChange={(open) => { if (!open) setCellMenu(null); }}
          trigger={['contextMenu']}
        >
          <div style={{ position: 'fixed', left: cellMenu.x, top: cellMenu.y, width: 1, height: 1, pointerEvents: 'none' }} />
        </Dropdown>
      )}

      {/* Header Context Menu */}
      {headerMenu && (
        <Dropdown
          open={true}
          menu={{ items: headerMenu.items, onClick: () => setHeaderMenu(null) }}
          onOpenChange={(open) => { if (!open) setHeaderMenu(null); }}
          trigger={['contextMenu']}
        >
          <div style={{ position: 'fixed', left: headerMenu.x, top: headerMenu.y, width: 1, height: 1, pointerEvents: 'none' }} />
        </Dropdown>
      )}
    </>
  );
}
