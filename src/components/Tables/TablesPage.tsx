import { useEffect, useState, useCallback } from 'react';
import {
  Select, Alert, Typography, Space, Table, Tag, Tooltip, Button,
  Modal, Form, Input, message, Descriptions,

} from 'antd';
import {
  TableOutlined,
  DatabaseOutlined,
  PlusOutlined,
  InfoCircleOutlined,
  ColumnWidthOutlined,
  SearchOutlined,
  DeleteOutlined,
  CodeOutlined,
  EditOutlined,
  EyeOutlined,
  CopyOutlined,
  BlockOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchDatabases, fetchTableDetails, fetchColumns, addColumn, adminExec, fetchShowCreate, fetchPartitions, execPartition, runQuery } from '../../api/client';
import { useQueryStore } from '../../store/queryStore';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import AutoRefresh from '../shared/AutoRefresh';
import CreateTableWizard from './CreateTableWizard';
import type { TableDetail, ColumnInfo } from '../../api/types';

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(n: number | null): string {
  if (n == null) return '-';
  return n.toLocaleString();
}

export default function TablesPage() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const environments = useEnvStore((s) => s.environments);
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const addTabWithSql = useQueryStore((s) => s.addTabWithSql);

  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [tables, setTables] = useState<TableDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);

  // Column detail drawer
  const [selectedTable, setSelectedTable] = useState<TableDetail | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // Create table wizard
  const [createOpen, setCreateOpen] = useState(false);

  // Add column modal
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColLoading, setAddColLoading] = useState(false);
  const [form] = Form.useForm();

  // DDL (SHOW CREATE) — for all object types, used by "Copy CREATE" and view/MV definition
  const [ddl, setDdl] = useState<string | null>(null);
  const [ddlLoading, setDdlLoading] = useState(false);

  // Partitions (base tables)
  const [partitions, setPartitions] = useState<Record<string, unknown>[]>([]);
  const [partsLoading, setPartsLoading] = useState(false);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [addPartSql, setAddPartSql] = useState('');
  const [addPartLoading, setAddPartLoading] = useState(false);

  // Create database modal
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [createDbLoading, setCreateDbLoading] = useState(false);
  const [createDbName, setCreateDbName] = useState('');
  const [createDbSQL, setCreateDbSQL] = useState('');

  const isReadOnly = (environments.find((e) => e.name === selectedEnv)?.read_only ?? true) || role !== 'admin';

  const ALL_DBS = '__all__';

  // Load databases and default to "All databases"
  useEffect(() => {
    if (!selectedEnv) return;
    setDbLoading(true);
    setDatabases([]);
    setSelectedDb(ALL_DBS);
    setTables([]);
    fetchDatabases(selectedEnv)
      .then((dbs) => {
        setDatabases(dbs);
      })
      .catch(() => {})
      .finally(() => setDbLoading(false));
  }, [selectedEnv]);

  const userDbs = databases.filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys');

  // Load table details
  const loadTables = useCallback(() => {
    if (!selectedEnv) {
      setTables([]);
      return;
    }
    setLoading(true);
    if (selectedDb === ALL_DBS) {
      // Fetch from all user databases in parallel
      Promise.all(
        userDbs.map((db) =>
          fetchTableDetails(selectedEnv, db)
            .then((items) => items.map((t) => ({ ...t, _db: db })))
            .catch(() => [] as TableDetail[])
        )
      )
        .then((results) => setTables(results.flat()))
        .finally(() => setLoading(false));
    } else if (selectedDb) {
      fetchTableDetails(selectedEnv, selectedDb)
        .then((items) => setTables(items.map((t) => ({ ...t, _db: selectedDb }))))
        .catch(() => setTables([]))
        .finally(() => setLoading(false));
    } else {
      setTables([]);
      setLoading(false);
    }
  }, [selectedEnv, selectedDb, userDbs.join(',')]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  // Create database handler
  const handleCreateDb = async () => {
    if (!selectedEnv || !createDbSQL.trim()) return;
    setCreateDbLoading(true);
    try {
      await adminExec(selectedEnv, createDbSQL);
      message.success(`Database "${createDbName.trim()}" created`);
      setCreateDbOpen(false);
      setCreateDbName('');
      setCreateDbSQL('');
      // Refresh database list
      fetchDatabases(selectedEnv).then((dbs) => {
        setDatabases(dbs);
        setSelectedDb(createDbName.trim());
      });
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreateDbLoading(false);
    }
  };

  // Load columns for selected table
  const getTableDb = (table: TableDetail) => (table as unknown as Record<string, unknown>)._db as string || selectedDb;

  const openDetail = useCallback(
    (table: TableDetail) => {
      setSelectedTable(table);
      setDetailOpen(true);
      setDdl(null);
      setColumnsLoading(true);
      const db = getTableDb(table);
      fetchColumns(selectedEnv!, db, table.name)
        .then(setColumns)
        .catch(() => setColumns([]))
        .finally(() => setColumnsLoading(false));
      // Fetch the CREATE/definition DDL for every object type (used by "Copy CREATE"
      // to replicate a table across environments, and to show view/MV definitions).
      setDdlLoading(true);
      fetchShowCreate(selectedEnv!, db, table.name, table.type)
        .then((res) => setDdl(res.ddl))
        .catch(() => setDdl(null))
        .finally(() => setDdlLoading(false));
      // Partitions — only meaningful for base tables.
      setPartitions([]);
      if (table.type === 'BASE TABLE') {
        setPartsLoading(true);
        fetchPartitions(selectedEnv!, db, table.name)
          .then(setPartitions)
          .catch(() => setPartitions([]))
          .finally(() => setPartsLoading(false));
      }
    },
    [selectedEnv, selectedDb],
  );

  // Handle URL params: ?db=xxx&table=yyy to auto-open detail
  useEffect(() => {
    const paramDb = searchParams.get('db');
    const paramTable = searchParams.get('table');
    if (paramDb && paramDb !== selectedDb) {
      setSelectedDb(paramDb);
    }
    if (paramDb && paramTable && tables.length > 0 && selectedDb === paramDb) {
      const found = tables.find((t) => t.name === paramTable);
      if (found) {
        openDetail(found);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, tables, selectedDb, openDetail, setSearchParams]);

  const handleAddColumn = async () => {
    try {
      const values = await form.validateFields();
      if (!selectedEnv || !selectedTable) return;

      const db = getTableDb(selectedTable);
      setAddColLoading(true);
      const colDef = `\`${values.name}\` ${values.type}${values.nullable ? '' : ' NOT NULL'}${values.defaultVal ? ` DEFAULT "${values.defaultVal}"` : ''}${values.comment ? ` COMMENT "${values.comment}"` : ''}`;
      const sql = `ALTER TABLE \`${db}\`.\`${selectedTable.name}\` ADD COLUMN ${colDef}`;

      await addColumn(selectedEnv, db, selectedTable.name, sql);
      message.success(`Column "${values.name}" added successfully`);
      setAddColOpen(false);
      form.resetFields();
      // Refresh columns
      openDetail(selectedTable);
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        message.error(`Failed: ${(err as Error).message}`);
      }
    } finally {
      setAddColLoading(false);
    }
  };

  const handleQueryTable = () => {
    if (!selectedTable) return;
    const db = getTableDb(selectedTable);
    addTabWithSql(
      `SELECT *\nFROM \`${db}\`.\`${selectedTable.name}\`\nLIMIT 100`,
      selectedTable.name,
    );
    setDetailOpen(false);
    navigate('/query');
  };

  const handleDropTable = () => {
    if (!selectedTable || !selectedEnv) return;
    const db = getTableDb(selectedTable);
    const fullName = `\`${db}\`.\`${selectedTable.name}\``;
    Modal.confirm({
      title: 'Drop Table',
      icon: <DeleteOutlined style={{ color: '#ef4444' }} />,
      content: (
        <div>
          <p>Are you sure you want to drop <strong>{db}.{selectedTable.name}</strong>?</p>
          <p style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>
            This action is irreversible. All data in this table will be permanently deleted.
          </p>
        </div>
      ),
      okText: 'Drop Table',
      okType: 'danger',
      onOk: async () => {
        try {
          await adminExec(selectedEnv, `DROP TABLE ${fullName}`);
          message.success(`Table ${selectedTable.name} dropped successfully`);
          setDetailOpen(false);
          loadTables();
        } catch (err) {
          message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });
  };

  const handleDropPartition = (partName: string) => {
    if (!selectedTable || !selectedEnv) return;
    const db = getTableDb(selectedTable);
    Modal.confirm({
      title: 'Drop Partition',
      icon: <DeleteOutlined style={{ color: '#ef4444' }} />,
      content: <p>Drop partition <strong>{partName}</strong> from <strong>{db}.{selectedTable.name}</strong>? Data in this partition is permanently deleted.</p>,
      okText: 'Drop Partition',
      okType: 'danger',
      onOk: async () => {
        try {
          await execPartition(selectedEnv, `ALTER TABLE \`${db}\`.\`${selectedTable.name}\` DROP PARTITION \`${partName}\``);
          message.success(`Partition ${partName} dropped`);
          openDetail(selectedTable);
        } catch (err) {
          message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });
  };

  const handleAnalyze = async () => {
    if (!selectedTable || !selectedEnv) return;
    const db = getTableDb(selectedTable);
    try {
      await runQuery(selectedEnv, `ANALYZE TABLE \`${db}\`.\`${selectedTable.name}\``);
      message.success(`Statistics collection started for ${selectedTable.name}`);
    } catch (err) {
      message.error(`Analyze failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openAddPartition = () => {
    if (!selectedTable) return;
    const db = getTableDb(selectedTable);
    setAddPartSql(`ALTER TABLE \`${db}\`.\`${selectedTable.name}\`\nADD PARTITION p20260101 VALUES [("2026-01-01"), ("2026-01-02"))`);
    setAddPartOpen(true);
  };

  const handleAddPartition = async () => {
    if (!selectedEnv || !addPartSql.trim()) return;
    setAddPartLoading(true);
    try {
      await execPartition(selectedEnv, addPartSql.trim());
      message.success('Partition added');
      setAddPartOpen(false);
      setAddPartSql('');
      if (selectedTable) openDetail(selectedTable);
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddPartLoading(false);
    }
  };

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to browse tables."
        type="info"
        showIcon
      />
    );
  }

  const tableColumns = [
    ...(selectedDb === ALL_DBS ? [{
      title: 'Database',
      dataIndex: '_db',
      key: '_db',
      width: 160,
      sorter: (a: TableDetail, b: TableDetail) => (getTableDb(a)).localeCompare(getTableDb(b)),
      filters: userDbs.map((db) => ({ text: db, value: db })),
      onFilter: (value: unknown, record: TableDetail) => getTableDb(record) === value,
      render: (v: string) => <Tag style={{ borderRadius: 4 }}>{v}</Tag>,
    }] : []),
    {
      title: 'Table Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: TableDetail, b: TableDetail) => a.name.localeCompare(b.name),
      render: (name: string, record: TableDetail) => (
        <Button type="link" style={{ padding: 0, fontWeight: 500 }} onClick={() => openDetail(record)}>
          {name}
        </Button>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 170,
      filters: [
        { text: 'Table', value: 'BASE TABLE' },
        { text: 'View', value: 'VIEW' },
        { text: 'Materialized View', value: 'MATERIALIZED VIEW' },
      ],
      onFilter: (value: unknown, record: TableDetail) => record.type === value,
      render: (type: string) => {
        const config: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
          'BASE TABLE': { color: 'blue', label: 'Table', icon: <TableOutlined /> },
          'VIEW': { color: 'purple', label: 'View', icon: <EyeOutlined /> },
          'MATERIALIZED VIEW': { color: 'volcano', label: 'Materialized View', icon: <CodeOutlined /> },
        };
        const c = config[type] || { color: 'default', label: type, icon: null };
        return <Tag color={c.color} icon={c.icon} style={{ borderRadius: 4 }}>{c.label}</Tag>;
      },
    },
    {
      title: 'Engine',
      dataIndex: 'engine',
      key: 'engine',
      width: 100,
      render: (v: string | null) => v || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
    },
    {
      title: 'Rows',
      dataIndex: 'rows',
      key: 'rows',
      width: 120,
      sorter: (a: TableDetail, b: TableDetail) => (a.rows ?? 0) - (b.rows ?? 0),
      render: (v: number | null) => <span style={{ fontFamily: 'monospace' }}>{formatNumber(v)}</span>,
    },
    {
      title: 'Data Size',
      dataIndex: 'data_length',
      key: 'data_length',
      width: 120,
      sorter: (a: TableDetail, b: TableDetail) => (a.data_length ?? 0) - (b.data_length ?? 0),
      render: (v: number | null) => formatBytes(v),
    },
    {
      title: 'Avg Row Size',
      dataIndex: 'avg_row_length',
      key: 'avg_row_length',
      width: 120,
      render: (v: number | null) => formatBytes(v),
    },
    {
      title: 'Created',
      dataIndex: 'create_time',
      key: 'create_time',
      width: 170,
      render: (v: string | null) => v || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
    },
    {
      title: 'Updated',
      dataIndex: 'update_time',
      key: 'update_time',
      width: 170,
      render: (v: string | null) => v || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
    },
    {
      title: 'Comment',
      dataIndex: 'comment',
      key: 'comment',
      ellipsis: true,
      render: (v: string | null) => v || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
    },
  ];

  const columnTableColumns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_: unknown, __: unknown, i: number) => <span style={{ color: 'var(--sr-text-muted)' }}>{i + 1}</span>,
    },
    {
      title: 'Column Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (v: string) => (
        <Tag color="geekblue" style={{ borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Nullable',
      dataIndex: 'nullable',
      key: 'nullable',
      width: 90,
      render: (v: string) => (
        v === 'YES'
          ? <Tag color="default" style={{ borderRadius: 4 }}>NULL</Tag>
          : <Tag color="orange" style={{ borderRadius: 4 }}>NOT NULL</Tag>
      ),
    },
    {
      title: 'Comment',
      dataIndex: 'comment',
      key: 'comment',
      ellipsis: true,
      render: (v: string) => v || <span style={{ color: 'var(--sr-text-muted)' }}>-</span>,
    },
  ];

  const partitionColumns = [
    { title: 'Partition', dataIndex: 'PartitionName', key: 'PartitionName', render: (v: string) => <span style={{ fontWeight: 500, fontSize: 12 }}>{v}</span> },
    { title: 'Range / Keys', key: 'range', ellipsis: true, render: (_: unknown, r: Record<string, unknown>) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{String(r.Range ?? r.PartitionKey ?? r.Keys ?? '-')}</span> },
    { title: 'Buckets', dataIndex: 'Buckets', key: 'Buckets', width: 80, render: (v: unknown) => <span style={{ fontSize: 12 }}>{v != null ? String(v) : '-'}</span> },
    { title: 'Rows', dataIndex: 'RowCount', key: 'RowCount', width: 100, render: (v: unknown) => <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{v != null ? Number(v).toLocaleString() : '-'}</span> },
    { title: 'Size', dataIndex: 'DataSize', key: 'DataSize', width: 100, render: (v: unknown) => <span style={{ fontSize: 12 }}>{v != null ? String(v) : '-'}</span> },
    { title: 'Updated', dataIndex: 'VisibleVersionTime', key: 'VisibleVersionTime', width: 160, render: (v: unknown) => <span style={{ fontSize: 12 }}>{v ? String(v) : '-'}</span> },
    ...(!isReadOnly ? [{
      title: '', key: 'act', width: 40,
      render: (_: unknown, r: Record<string, unknown>) => (
        <Tooltip title="Drop partition">
          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDropPartition(String(r.PartitionName))} />
        </Tooltip>
      ),
    }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <TableOutlined style={{ marginRight: 8 }} />
            Tables
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Browse table structure, columns, and metadata for your StarRocks databases.
          </Typography.Text>
        </div>
        <Space>
          {!isReadOnly && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
              style={{ borderRadius: 8 }}
            >
              Create Table
            </Button>
          )}
          <AutoRefresh onRefresh={loadTables} loading={loading} />
        </Space>
      </div>

      {/* Database selector */}
      <div className="sr-card" style={{ padding: 16 }}>
        <Space size={12}>
          <Space size={6}>
            <DatabaseOutlined style={{ color: '#f59e0b' }} />
            <Typography.Text strong style={{ fontSize: 13 }}>Database:</Typography.Text>
            <Select
              value={selectedDb || undefined}
              onChange={(v) => setSelectedDb(v)}
              placeholder="Select a database"
              loading={dbLoading}
              showSearch
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: 280 }}
              options={[
                { value: ALL_DBS, label: 'All Databases' },
                ...userDbs.map((db) => ({ value: db, label: db })),
              ]}
            />
            {!isReadOnly && (
              <Tooltip title="Create database">
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => setCreateDbOpen(true)}
                  style={{ borderRadius: 6 }}
                />
              </Tooltip>
            )}
          </Space>
          {selectedDb && !loading && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {tables.length} table{tables.length !== 1 ? 's' : ''}
            </Typography.Text>
          )}
        </Space>
      </div>

      {/* Table list */}
      {selectedDb && (
        <div className="sr-card" style={{ padding: 16 }}>
          <Table
            className="sr-table"
            columns={tableColumns}
            dataSource={tables.map((t) => ({ ...t, key: t.name }))}
            size="small"
            loading={loading}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} total` }}
            scroll={{ x: 'max-content' }}
          />
        </div>
      )}

      {/* Table detail modal */}
      <Modal
        title={
          <Space>
            {selectedTable?.type === 'MATERIALIZED VIEW' ? <CodeOutlined /> : selectedTable?.type === 'VIEW' ? <EyeOutlined /> : <TableOutlined />}
            <span>{selectedTable ? getTableDb(selectedTable) : ''}.{selectedTable?.name}</span>
            {selectedTable && selectedTable.type !== 'BASE TABLE' && (
              <Tag color={selectedTable.type === 'MATERIALIZED VIEW' ? 'volcano' : 'purple'} style={{ borderRadius: 4, fontSize: 11 }}>
                {selectedTable.type === 'MATERIALIZED VIEW' ? 'Materialized View' : 'View'}
              </Tag>
            )}
          </Space>
        }
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={800}
      >
        {selectedTable && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                icon={<SearchOutlined />}
                onClick={handleQueryTable}
                style={{ borderRadius: 6 }}
              >
                Query
              </Button>
              <Tooltip title="Copy the full CREATE statement — paste it in another environment (e.g. prod) to recreate this object">
                <Button
                  icon={<CopyOutlined />}
                  disabled={!ddl}
                  onClick={() => { if (ddl) { navigator.clipboard.writeText(ddl); message.success('CREATE statement copied'); } }}
                  style={{ borderRadius: 6 }}
                >
                  Copy CREATE
                </Button>
              </Tooltip>
              {selectedTable.type === 'BASE TABLE' && !isReadOnly && (
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => setAddColOpen(true)}
                  style={{ borderRadius: 6 }}
                >
                  Add Column
                </Button>
              )}
              {selectedTable.type === 'BASE TABLE' && !isReadOnly && (
                <Tooltip title="Collect CBO statistics (ANALYZE TABLE) — improves query plans">
                  <Button icon={<BarChartOutlined />} onClick={handleAnalyze} style={{ borderRadius: 6 }}>
                    Analyze
                  </Button>
                </Tooltip>
              )}
              {(selectedTable.type === 'VIEW' || selectedTable.type === 'MATERIALIZED VIEW') && ddl && (
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    addTabWithSql(ddl, selectedTable.name);
                    setDetailOpen(false);
                    navigate('/query');
                  }}
                  style={{ borderRadius: 6 }}
                >
                  Edit in Console
                </Button>
              )}
              <div style={{ flex: 1 }} />
              {!isReadOnly && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleDropTable}
                  style={{ borderRadius: 6 }}
                >
                  Drop
                </Button>
              )}
            </div>

            {/* CREATE / definition DDL — shown for every object type */}
            {(ddlLoading || ddl) && (
              <div style={{ marginTop: 4 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  <CodeOutlined style={{ marginRight: 6 }} />
                  {selectedTable.type === 'BASE TABLE' ? 'CREATE statement' : 'Definition'}
                </Typography.Text>
                {ddlLoading ? (
                  <div style={{ padding: '12px 0', color: 'var(--sr-text-muted)', fontSize: 12 }}>Loading...</div>
                ) : ddl ? (
                  <pre style={{
                    marginTop: 8,
                    padding: 12,
                    background: 'var(--sr-card-alt)',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 250,
                    overflow: 'auto',
                    color: 'var(--sr-text)',
                    lineHeight: 1.6,
                  }}>{ddl}</pre>
                ) : (
                  <div style={{ padding: '8px 0', color: 'var(--sr-text-muted)', fontSize: 12 }}>Could not load definition.</div>
                )}
              </div>
            )}

            {/* Columns */}
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                <ColumnWidthOutlined style={{ marginRight: 6 }} />
                Columns ({columns.length})
              </Typography.Text>
            </div>

            <Table
              className="sr-table"
              columns={columnTableColumns}
              dataSource={columns.map((c, i) => ({ ...c, key: i }))}
              size="small"
              loading={columnsLoading}
              pagination={false}
              scroll={{ y: 300 }}
            />

            {/* Partitions (base tables) */}
            {selectedTable.type === 'BASE TABLE' && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Tooltip title="Partitions split a table by a key (often a date) so StarRocks scans/retains only what's needed. Dynamic partitioning can add/drop them automatically.">
                    <Typography.Text strong style={{ fontSize: 13, cursor: 'help' }}>
                      <BlockOutlined style={{ marginRight: 6 }} />
                      Partitions ({partitions.length})
                      <InfoCircleOutlined style={{ marginLeft: 6, color: 'var(--sr-text-muted)' }} />
                    </Typography.Text>
                  </Tooltip>
                  {!isReadOnly && (
                    <Button size="small" icon={<PlusOutlined />} onClick={openAddPartition}>Add partition</Button>
                  )}
                </div>
                <Table
                  className="sr-table"
                  size="small"
                  loading={partsLoading}
                  columns={partitionColumns}
                  dataSource={partitions.map((p, i) => ({ ...p, key: String(p.PartitionName ?? i) }))}
                  pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true }}
                  scroll={{ x: 'max-content', y: 220 }}
                  locale={{ emptyText: <span style={{ color: 'var(--sr-text-muted)' }}>Unpartitioned table.</span> }}
                />
              </div>
            )}

            {/* Summary below columns */}
            <Descriptions
              size="small"
              bordered
              column={2}
              style={{ marginTop: 4 }}
              labelStyle={{ padding: '6px 12px', fontWeight: 500, fontSize: 12, color: 'var(--sr-text-secondary)' }}
              contentStyle={{ padding: '6px 12px', fontSize: 13 }}
            >
              <Descriptions.Item label="Type">{selectedTable.type}</Descriptions.Item>
              <Descriptions.Item label="Engine">{selectedTable.engine || '-'}</Descriptions.Item>
              <Descriptions.Item label="Rows">{formatNumber(selectedTable.rows)}</Descriptions.Item>
              <Descriptions.Item label="Data Size">{formatBytes(selectedTable.data_length)}</Descriptions.Item>
              <Descriptions.Item label="Created">{selectedTable.create_time || '-'}</Descriptions.Item>
              <Descriptions.Item label="Updated">{selectedTable.update_time || '-'}</Descriptions.Item>
              {selectedTable.comment && (
                <Descriptions.Item label="Comment" span={2}>{selectedTable.comment}</Descriptions.Item>
              )}
            </Descriptions>
          </div>
        )}
      </Modal>

      {/* Create Table Wizard */}
      <CreateTableWizard
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          loadTables();
        }}
        databases={databases}
        initialDb={selectedDb}
      />

      {/* Add Column Modal */}
      <Modal
        title="Add Column"
        open={addColOpen}
        onCancel={() => { setAddColOpen(false); form.resetFields(); }}
        onOk={handleAddColumn}
        confirmLoading={addColLoading}
        okText="Add Column"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Column Name"
            rules={[{ required: true, message: 'Column name is required' }]}
          >
            <Input placeholder="e.g. new_column" />
          </Form.Item>
          <Form.Item
            name="type"
            label="Data Type"
            rules={[{ required: true, message: 'Data type is required' }]}
          >
            <Select
              showSearch
              placeholder="Select data type"
              options={[
                { label: 'String Types', options: [
                  { value: 'VARCHAR(255)', label: 'VARCHAR(255)' },
                  { value: 'VARCHAR(65533)', label: 'VARCHAR(65533)' },
                  { value: 'STRING', label: 'STRING' },
                  { value: 'CHAR(50)', label: 'CHAR(50)' },
                ]},
                { label: 'Numeric Types', options: [
                  { value: 'INT', label: 'INT' },
                  { value: 'BIGINT', label: 'BIGINT' },
                  { value: 'TINYINT', label: 'TINYINT' },
                  { value: 'SMALLINT', label: 'SMALLINT' },
                  { value: 'LARGEINT', label: 'LARGEINT' },
                  { value: 'FLOAT', label: 'FLOAT' },
                  { value: 'DOUBLE', label: 'DOUBLE' },
                  { value: 'DECIMAL(18,2)', label: 'DECIMAL(18,2)' },
                ]},
                { label: 'Date/Time Types', options: [
                  { value: 'DATE', label: 'DATE' },
                  { value: 'DATETIME', label: 'DATETIME' },
                ]},
                { label: 'Other Types', options: [
                  { value: 'BOOLEAN', label: 'BOOLEAN' },
                  { value: 'JSON', label: 'JSON' },
                  { value: 'ARRAY<STRING>', label: 'ARRAY<STRING>' },
                  { value: 'MAP<STRING,STRING>', label: 'MAP<STRING,STRING>' },
                ]},
              ]}
            />
          </Form.Item>
          <Form.Item name="nullable" valuePropName="checked" initialValue={true}>
            <Tooltip title="Whether the column allows NULL values">
              <Space>
                <input type="checkbox" id="nullable-check" defaultChecked />
                <label htmlFor="nullable-check">Nullable</label>
                <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
              </Space>
            </Tooltip>
          </Form.Item>
          <Form.Item name="defaultVal" label="Default Value">
            <Input placeholder="Optional default value" />
          </Form.Item>
          <Form.Item name="comment" label="Comment">
            <Input placeholder="Optional column description" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Add Partition Modal */}
      <Modal
        title="Add Partition"
        open={addPartOpen}
        onCancel={() => { setAddPartOpen(false); setAddPartSql(''); }}
        onOk={handleAddPartition}
        confirmLoading={addPartLoading}
        okText="Add Partition"
        okButtonProps={{ disabled: !addPartSql.trim() }}
        width={640}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          Edit the ALTER statement below. The example adds a daily range partition; for LIST partitions use <code>VALUES IN (...)</code>. Tables with dynamic partitioning usually add/drop partitions automatically.
        </Typography.Paragraph>
        <Input.TextArea
          value={addPartSql}
          onChange={(e) => setAddPartSql(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      {/* Create Database Modal */}
      <Modal
        title="Create Database"
        open={createDbOpen}
        onCancel={() => { setCreateDbOpen(false); setCreateDbName(''); setCreateDbSQL(''); }}
        onOk={handleCreateDb}
        confirmLoading={createDbLoading}
        okText="Create"
        okButtonProps={{ disabled: !createDbSQL.trim() }}
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Database Name" required>
            <Input
              value={createDbName}
              onChange={(e) => {
                setCreateDbName(e.target.value);
                setCreateDbSQL(`CREATE DATABASE IF NOT EXISTS \`${e.target.value.trim()}\``);
              }}
              placeholder="e.g. analytics"
              onPressEnter={handleCreateDb}
              prefix={<DatabaseOutlined style={{ color: 'var(--sr-text-muted)' }} />}
            />
          </Form.Item>
          <Form.Item label="SQL">
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
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
