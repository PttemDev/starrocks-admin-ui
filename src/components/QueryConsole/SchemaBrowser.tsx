import { useEffect, useState } from 'react';
import { Input, Tooltip, Spin, Typography, Dropdown, Modal, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  DatabaseOutlined,
  TableOutlined,
  ColumnWidthOutlined,
  SearchOutlined,
  RightOutlined,
  DownOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  UnorderedListOutlined,
  EyeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSchemaStore } from '../../store/schemaStore';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import { useQueryStore } from '../../store/queryStore';
import { adminExec } from '../../api/client';
import type { ColumnInfo } from '../../api/types';

const TYPE_COLORS: Record<string, string> = {
  int: '#6366f1',
  bigint: '#6366f1',
  tinyint: '#6366f1',
  smallint: '#6366f1',
  largeint: '#6366f1',
  float: '#6366f1',
  double: '#6366f1',
  decimal: '#6366f1',
  varchar: '#10b981',
  char: '#10b981',
  string: '#10b981',
  text: '#10b981',
  date: '#f59e0b',
  datetime: '#f59e0b',
  timestamp: '#f59e0b',
  boolean: '#ef4444',
  json: '#3b82f6',
  array: '#3b82f6',
  map: '#3b82f6',
  struct: '#3b82f6',
  bitmap: '#8b5cf6',
  hll: '#8b5cf6',
};

function getTypeColor(type: string): string {
  const lower = type.toLowerCase();
  for (const [key, color] of Object.entries(TYPE_COLORS)) {
    if (lower.startsWith(key)) return color;
  }
  return 'var(--sr-text-muted)';
}

/** Insert text into the active Monaco editor */
function insertIntoEditor(text: string) {
  window.dispatchEvent(
    new CustomEvent('sr-insert-sql', { detail: text }),
  );
}

function ColumnRow({ col, dbName, tableName }: { col: ColumnInfo; dbName: string; tableName: string }) {
  const typeColor = getTypeColor(col.type);
  return (
    <Tooltip
      title={
        <div style={{ fontSize: 12 }}>
          <div><strong>{dbName}.{tableName}.{col.name}</strong></div>
          <div>Type: {col.type}</div>
          <div>Nullable: {col.nullable}</div>
          {col.comment && <div>Comment: {col.comment}</div>}
        </div>
      }
      placement="right"
      mouseEnterDelay={0.3}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px 3px 48px',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--sr-text-secondary)',
          borderRadius: 4,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sr-border-subtle)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={() => insertIntoEditor(col.name)}
      >
        <ColumnWidthOutlined style={{ fontSize: 11, color: 'var(--sr-text-muted)', flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {col.name}
        </span>
        <span
          style={{
            fontSize: 10,
            color: typeColor,
            fontFamily: 'monospace',
            flexShrink: 0,
          }}
        >
          {col.type}
        </span>
      </div>
    </Tooltip>
  );
}

function TableRow({
  db,
  table,
  columns,
}: {
  db: string;
  table: string;
  columns: ColumnInfo[] | undefined;
}) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const loadColumns = useSchemaStore((s) => s.loadColumns);
  const addTabWithSql = useQueryStore((s) => s.addTabWithSql);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = () => {
    if (!expanded && !loaded && selectedEnv) {
      loadColumns(selectedEnv, db, table);
      setLoaded(true);
    }
    setExpanded(!expanded);
  };

  const qualifiedName = `\`${db}\`.\`${table}\``;

  const contextMenu: MenuProps['items'] = [
    {
      key: 'select-star',
      icon: <PlayCircleOutlined />,
      label: 'SELECT * FROM table',
      onClick: () => {
        addTabWithSql(
          `SELECT *\nFROM ${qualifiedName}\nLIMIT 100`,
          table,
        );
      },
    },
    {
      key: 'select-columns',
      icon: <UnorderedListOutlined />,
      label: 'SELECT with columns',
      onClick: () => {
        const cols = columns;
        if (cols && cols.length > 0) {
          const colList = cols.map((c) => `  ${c.name}`).join(',\n');
          addTabWithSql(
            `SELECT\n${colList}\nFROM ${qualifiedName}\nLIMIT 100`,
            table,
          );
        } else {
          // Columns not loaded yet, fall back to *
          addTabWithSql(
            `SELECT *\nFROM ${qualifiedName}\nLIMIT 100`,
            table,
          );
        }
      },
    },
    { type: 'divider' },
    {
      key: 'view-tables',
      icon: <EyeOutlined />,
      label: 'View in Tables',
      onClick: () => {
        navigate(`/tables?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}`);
      },
    },
  ];

  return (
    <>
      <Dropdown menu={{ items: contextMenu }} trigger={['contextMenu']}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px 4px 32px',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--sr-text)',
            borderRadius: 4,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sr-border-subtle)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          onClick={toggle}
        >
          {expanded ? (
            <DownOutlined style={{ fontSize: 8, color: 'var(--sr-text-muted)' }} />
          ) : (
            <RightOutlined style={{ fontSize: 8, color: 'var(--sr-text-muted)' }} />
          )}
          <TableOutlined style={{ fontSize: 12, color: '#6366f1', flexShrink: 0 }} />
          <span
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              insertIntoEditor(qualifiedName);
            }}
          >
            {table}
          </span>
          {columns && (
            <span style={{ fontSize: 10, color: 'var(--sr-text-muted)' }}>{columns.length}</span>
          )}
        </div>
      </Dropdown>
      {expanded && columns && columns.map((col) => (
        <ColumnRow key={col.name} col={col} dbName={db} tableName={table} />
      ))}
      {expanded && !columns && (
        <div style={{ padding: '4px 48px', fontSize: 11, color: 'var(--sr-text-muted)' }}>
          Loading...
        </div>
      )}
    </>
  );
}

function DatabaseRow({ db }: { db: string }) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const { tables, columns, expandedDbs, loadTables, toggleDb } = useSchemaStore();
  const expanded = expandedDbs.includes(db);
  const dbTables = tables[db];

  const toggle = () => {
    if (!expanded && !dbTables && selectedEnv) {
      loadTables(selectedEnv, db);
    }
    toggleDb(db);
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--sr-text)',
          borderRadius: 4,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sr-border-subtle)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={toggle}
      >
        {expanded ? (
          <DownOutlined style={{ fontSize: 8, color: 'var(--sr-text-muted)' }} />
        ) : (
          <RightOutlined style={{ fontSize: 8, color: 'var(--sr-text-muted)' }} />
        )}
        <DatabaseOutlined style={{ fontSize: 12, color: '#f59e0b', flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {db}
        </span>
        {dbTables && (
          <span style={{ fontSize: 10, color: 'var(--sr-text-muted)' }}>{dbTables.length}</span>
        )}
      </div>
      {expanded && dbTables && dbTables.map((table) => (
        <TableRow
          key={table}
          db={db}
          table={table}
          columns={columns[`${db}.${table}`]}
        />
      ))}
      {expanded && !dbTables && (
        <div style={{ padding: '4px 32px', fontSize: 11, color: 'var(--sr-text-muted)' }}>
          Loading...
        </div>
      )}
    </>
  );
}

export default function SchemaBrowser() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);
  const environments = useEnvStore((s) => s.environments);
  const isReadOnly = (environments.find((e) => e.name === selectedEnv)?.read_only ?? true) || role !== 'admin';
  const { databases, loading, loadDatabases, reset } = useSchemaStore();
  const [filter, setFilter] = useState('');
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createDbName, setCreateDbName] = useState('');
  const [createDbSQL, setCreateDbSQL] = useState('');
  const [createDbLoading, setCreateDbLoading] = useState(false);

  const handleCreateDb = async () => {
    if (!selectedEnv || !createDbSQL.trim()) return;
    setCreateDbLoading(true);
    try {
      await adminExec(selectedEnv, createDbSQL);
      message.success(`Database "${createDbName.trim()}" created`);
      setCreateDbOpen(false);
      setCreateDbName('');
      setCreateDbSQL('');
      loadDatabases(selectedEnv);
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreateDbLoading(false);
    }
  };

  useEffect(() => {
    if (selectedEnv) {
      reset();
      loadDatabases(selectedEnv);
    }
  }, [selectedEnv, reset, loadDatabases]);

  const filteredDbs = filter
    ? databases.filter((db) => db.toLowerCase().includes(filter.toLowerCase()))
    : databases;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRight: '1px solid var(--sr-border)',
        background: 'var(--sr-card)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <DatabaseOutlined style={{ fontSize: 13, color: '#6366f1' }} />
        <Typography.Text strong style={{ fontSize: 13, flex: 1 }}>
          Schema
        </Typography.Text>
        {!isReadOnly && (
          <Tooltip title="Create database">
            <PlusOutlined
              style={{ fontSize: 12, color: 'var(--sr-text-muted)', cursor: 'pointer' }}
              onClick={() => setCreateDbOpen(true)}
            />
          </Tooltip>
        )}
        <Tooltip title="Refresh schema">
          <ReloadOutlined
            style={{ fontSize: 12, color: 'var(--sr-text-muted)', cursor: 'pointer' }}
            onClick={() => selectedEnv && loadDatabases(selectedEnv)}
          />
        </Tooltip>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 8px 4px' }}>
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--sr-text-faint)', fontSize: 12 }} />}
          placeholder="Filter databases..."
          size="small"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          allowClear
          style={{ borderRadius: 6, fontSize: 12 }}
        />
      </div>

      {/* Tree */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 4px',
        }}
      >
        <Spin spinning={loading} size="small">
          {filteredDbs.length === 0 && !loading && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--sr-text-muted)', fontSize: 12 }}>
              {selectedEnv
                ? filter
                  ? 'No matching databases'
                  : 'No databases found'
                : 'Select an environment'}
            </div>
          )}
          {filteredDbs.map((db) => (
            <DatabaseRow key={db} db={db} />
          ))}
        </Spin>
      </div>

      {/* Hint */}
      <div
        style={{
          padding: '6px 12px',
          borderTop: '1px solid #f1f5f9',
          fontSize: 10,
          color: 'var(--sr-text-muted)',
          lineHeight: '16px',
        }}
      >
        Right-click table for query options. Click column to insert.
      </div>

      {/* Create Database Modal */}
      <Modal
        title="Create Database"
        open={createDbOpen}
        onCancel={() => { setCreateDbOpen(false); setCreateDbName(''); setCreateDbSQL(''); }}
        onOk={handleCreateDb}
        confirmLoading={createDbLoading}
        okText="Create"
        okButtonProps={{ disabled: !createDbSQL.trim() }}
        width={480}
      >
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            value={createDbName}
            onChange={(e) => {
              setCreateDbName(e.target.value);
              setCreateDbSQL(`CREATE DATABASE IF NOT EXISTS \`${e.target.value.trim()}\``);
            }}
            placeholder="Database name"
            onPressEnter={handleCreateDb}
            prefix={<DatabaseOutlined style={{ color: 'var(--sr-text-muted)' }} />}
          />
          <Input.TextArea
            value={createDbSQL}
            onChange={(e) => setCreateDbSQL(e.target.value)}
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              background: 'var(--sr-code-bg)',
              color: 'var(--sr-code-fg)',
              border: '1px solid var(--sr-code-border)',
              borderRadius: 8,
            }}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      </Modal>
    </div>
  );
}
