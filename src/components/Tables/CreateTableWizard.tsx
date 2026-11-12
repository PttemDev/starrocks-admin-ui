import { useState, useMemo } from 'react';
import {
  Modal, Steps, Button, Form, Input, Select, Space, Typography,
  InputNumber, Switch, Table, Tag, Tooltip, message, Divider, Card, Row, Col, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, InfoCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined, CopyOutlined,
} from '@ant-design/icons';
import { createTable } from '../../api/client';
import { useEnvStore } from '../../store/envStore';

// ── Data type options ──────────────────────────────────────────────

const DATA_TYPES = [
  { label: 'String Types', options: [
    { value: 'VARCHAR(255)', label: 'VARCHAR(255)' },
    { value: 'VARCHAR(65533)', label: 'VARCHAR(65533)' },
    { value: 'STRING', label: 'STRING' },
    { value: 'CHAR(50)', label: 'CHAR(50)' },
    { value: 'VARBINARY', label: 'VARBINARY' },
  ]},
  { label: 'Numeric Types', options: [
    { value: 'TINYINT', label: 'TINYINT (1 byte)' },
    { value: 'SMALLINT', label: 'SMALLINT (2 bytes)' },
    { value: 'INT', label: 'INT (4 bytes)' },
    { value: 'BIGINT', label: 'BIGINT (8 bytes)' },
    { value: 'LARGEINT', label: 'LARGEINT (16 bytes)' },
    { value: 'FLOAT', label: 'FLOAT' },
    { value: 'DOUBLE', label: 'DOUBLE' },
    { value: 'DECIMAL(18,2)', label: 'DECIMAL(18,2)' },
    { value: 'DECIMAL(38,6)', label: 'DECIMAL(38,6)' },
  ]},
  { label: 'Date/Time', options: [
    { value: 'DATE', label: 'DATE' },
    { value: 'DATETIME', label: 'DATETIME' },
  ]},
  { label: 'Semi-Structured', options: [
    { value: 'JSON', label: 'JSON' },
    { value: 'ARRAY<STRING>', label: 'ARRAY<STRING>' },
    { value: 'ARRAY<INT>', label: 'ARRAY<INT>' },
    { value: 'ARRAY<BIGINT>', label: 'ARRAY<BIGINT>' },
    { value: 'MAP<STRING,STRING>', label: 'MAP<STRING,STRING>' },
  ]},
  { label: 'Other', options: [
    { value: 'BOOLEAN', label: 'BOOLEAN' },
    { value: 'BITMAP', label: 'BITMAP' },
    { value: 'HLL', label: 'HLL' },
  ]},
];

const AGG_FUNCTIONS = [
  { value: '', label: 'None' },
  { value: 'SUM', label: 'SUM' },
  { value: 'MAX', label: 'MAX' },
  { value: 'MIN', label: 'MIN' },
  { value: 'REPLACE', label: 'REPLACE' },
  { value: 'HLL_UNION', label: 'HLL_UNION' },
  { value: 'BITMAP_UNION', label: 'BITMAP_UNION' },
];

const TABLE_MODELS = [
  { value: 'DUPLICATE', label: 'Duplicate Key', desc: 'Allows duplicate rows. Best for raw data, logs, unrestricted queries.' },
  { value: 'PRIMARY', label: 'Primary Key', desc: 'Real-time updates with upsert semantics. Best for OLTP-like workloads.' },
  { value: 'UNIQUE', label: 'Unique Key', desc: 'Last-write-wins for same key. Simpler alternative to Primary Key.' },
  { value: 'AGGREGATE', label: 'Aggregate Key', desc: 'Pre-aggregates value columns (SUM, MAX, MIN, REPLACE). Best for metrics.' },
];

const COMPRESSION_OPTIONS = [
  { value: 'LZ4', label: 'LZ4 (default, fastest)' },
  { value: 'ZSTD', label: 'ZSTD (best ratio)' },
  { value: 'ZLIB', label: 'ZLIB' },
  { value: 'SNAPPY', label: 'Snappy' },
];

// ── Column interface ──────────────────────────────────────────────

interface ColumnDef {
  id: number;
  name: string;
  type: string;
  nullable: boolean;
  defaultVal: string;
  comment: string;
  isKey: boolean;
  aggFunction: string;
  autoIncrement: boolean;
}

let colIdCounter = 0;
function newColumn(): ColumnDef {
  return {
    id: ++colIdCounter,
    name: '',
    type: 'VARCHAR(255)',
    nullable: true,
    defaultVal: '',
    comment: '',
    isKey: false,
    aggFunction: '',
    autoIncrement: false,
  };
}

// ── Index interface ───────────────────────────────────────────────

interface IndexDef {
  id: number;
  name: string;
  column: string;
  type: 'BITMAP' | 'BLOOM_FILTER';
  comment: string;
}

let idxIdCounter = 0;
function newIndex(): IndexDef {
  return { id: ++idxIdCounter, name: '', column: '', type: 'BITMAP', comment: '' };
}

// ── Props ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  databases: string[];
  initialDb?: string;
}

export default function CreateTableWizard({ open, onClose, onSuccess, databases, initialDb }: Props) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const environments = useEnvStore((s) => s.environments);
  const currentEnv = environments.find((e) => e.name === selectedEnv);
  const envReplicationNum = currentEnv?.default_replication_num || 3;
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Basic
  const [database, setDatabase] = useState(initialDb || '');
  const [tableName, setTableName] = useState('');
  const [tableModel, setTableModel] = useState<string>('DUPLICATE');
  const [tableComment, setTableComment] = useState('');

  // Step 2: Columns
  const [columns, setColumns] = useState<ColumnDef[]>([newColumn()]);

  // Step 3: Keys & Distribution
  const [distStrategy, setDistStrategy] = useState<'HASH' | 'RANDOM'>('HASH');
  const [distColumns, setDistColumns] = useState<string[]>([]);
  const [bucketCount, setBucketCount] = useState<number | null>(null);
  const [sortColumns, setSortColumns] = useState<string[]>([]);

  // Step 4: Partitioning
  const [partitionType, setPartitionType] = useState<'NONE' | 'EXPR' | 'RANGE'>('NONE');
  const [partExprFunc, setPartExprFunc] = useState('date_trunc');
  const [partExprGranularity, setPartExprGranularity] = useState('day');
  const [partExprColumn, setPartExprColumn] = useState('');
  const [partRangeColumn, setPartRangeColumn] = useState('');
  const [partRangeStart, setPartRangeStart] = useState('');
  const [partRangeEnd, setPartRangeEnd] = useState('');
  const [partRangeInterval, setPartRangeInterval] = useState('1 MONTH');

  // Step 5: Indexes & Properties
  const [indexes, setIndexes] = useState<IndexDef[]>([]);
  const [replicationNum, setReplicationNum] = useState(envReplicationNum);
  const [compression, setCompression] = useState('LZ4');
  const [storageMedium, setStorageMedium] = useState('');
  const [enableFastSchema, setEnableFastSchema] = useState(true);
  const [enablePersistentIndex, setEnablePersistentIndex] = useState(true);
  const [editedSQL, setEditedSQL] = useState('');

  // ── Reset on open ──────────────────────────────────────────────

  const resetAll = () => {
    setStep(0);
    setDatabase(initialDb || '');
    setTableName('');
    setTableModel('DUPLICATE');
    setTableComment('');
    setColumns([newColumn()]);
    setDistStrategy('HASH');
    setDistColumns([]);
    setBucketCount(null);
    setSortColumns([]);
    setPartitionType('NONE');
    setPartExprFunc('date_trunc');
    setPartExprGranularity('day');
    setPartExprColumn('');
    setPartRangeColumn('');
    setPartRangeStart('');
    setPartRangeEnd('');
    setPartRangeInterval('1 MONTH');
    setIndexes([]);
    setReplicationNum(envReplicationNum);
    setCompression('LZ4');
    setStorageMedium('');
    setEnableFastSchema(true);
    setEnablePersistentIndex(true);
    setEditedSQL('');
  };

  // ── Column helpers ─────────────────────────────────────────────

  const addCol = () => setColumns([...columns, newColumn()]);
  const removeCol = (id: number) => setColumns(columns.filter((c) => c.id !== id));
  const updateCol = (id: number, field: keyof ColumnDef, value: unknown) => {
    setColumns(columns.map((c) => c.id === id ? { ...c, [field]: value } : c));
  };
  const moveCol = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= columns.length) return;
    const arr = [...columns];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    setColumns(arr);
  };

  const keyColumns = columns.filter((c) => c.isKey);
  // True when the keys are not already the leading columns — the generated DDL
  // reorders them, and this drives the notice explaining that it happened.
  const keysNeedReorder =
    keyColumns.length > 0 && columns.slice(0, keyColumns.length).some((c) => !c.isKey);
  const colNames = columns.filter((c) => c.name).map((c) => c.name);
  const dateColumns = columns.filter((c) => ['DATE', 'DATETIME'].includes(c.type.toUpperCase()));
  const keyColumnNames = keyColumns.map((c) => c.name);
  const needsKeyPartition = tableModel === 'PRIMARY' || tableModel === 'UNIQUE';
  const activePartColumn = partitionType === 'EXPR' ? partExprColumn : partitionType === 'RANGE' ? partRangeColumn : '';
  const partColumnNotInKey = needsKeyPartition && !!activePartColumn && !keyColumnNames.includes(activePartColumn);

  // ── SQL Generation ─────────────────────────────────────────────

  const generatedSQL = useMemo(() => {
    const lines: string[] = [];
    lines.push(`CREATE TABLE \`${database}\`.\`${tableName}\` (`);

    // StarRocks requires the key columns to be an ordered prefix of the schema,
    // so emit them first (keeping their relative order) instead of rejecting the
    // DDL. The user's own ordering is preserved among the value columns.
    const orderedCols = [
      ...columns.filter((c) => c.isKey),
      ...columns.filter((c) => !c.isKey),
    ];

    // Columns
    const colLines: string[] = [];
    for (const col of orderedCols) {
      if (!col.name || !col.type) continue;
      let line = `  \`${col.name}\` ${col.type}`;
      if (col.autoIncrement) line += ' AUTO_INCREMENT';
      if (tableModel === 'AGGREGATE' && col.aggFunction && !col.isKey) {
        line += ` ${col.aggFunction}`;
      }
      // Primary Key columns must be NOT NULL; for other models the key is
      // implicitly non-null, so only an explicit choice adds the clause.
      if ((tableModel === 'PRIMARY' && col.isKey) || (!col.nullable && !col.isKey)) {
        line += ' NOT NULL';
      }
      if (col.defaultVal) line += ` DEFAULT "${col.defaultVal}"`;
      if (col.comment) line += ` COMMENT "${col.comment}"`;
      colLines.push(line);
    }

    // Indexes inline
    for (const idx of indexes) {
      if (!idx.name || !idx.column) continue;
      let line = `  INDEX \`${idx.name}\` (\`${idx.column}\`) USING ${idx.type}`;
      if (idx.comment) line += ` COMMENT '${idx.comment}'`;
      colLines.push(line);
    }

    lines.push(colLines.join(',\n'));
    lines.push(')');

    lines.push('ENGINE = OLAP');

    // Key clause must come after ENGINE = OLAP
    const keyNames = keyColumns.map((c) => `\`${c.name}\``).join(', ');
    if (keyNames) {
      if (tableModel === 'PRIMARY') lines.push(`PRIMARY KEY (${keyNames})`);
      else if (tableModel === 'UNIQUE') lines.push(`UNIQUE KEY (${keyNames})`);
      else if (tableModel === 'AGGREGATE') lines.push(`AGGREGATE KEY (${keyNames})`);
      else lines.push(`DUPLICATE KEY (${keyNames})`);
    }

    if (tableComment) {
      lines.push(`COMMENT "${tableComment}"`);
    }

    // Partition
    if (partitionType === 'EXPR' && partExprColumn) {
      lines.push(`PARTITION BY ${partExprFunc}('${partExprGranularity}', \`${partExprColumn}\`)`);
    } else if (partitionType === 'RANGE' && partRangeColumn && partRangeStart && partRangeEnd) {
      lines.push(`PARTITION BY RANGE (\`${partRangeColumn}\`) (`);
      lines.push(`  START ("${partRangeStart}") END ("${partRangeEnd}") EVERY (INTERVAL ${partRangeInterval})`);
      lines.push(')');
    }

    // Distribution
    if (distStrategy === 'HASH' && distColumns.length > 0) {
      const dist = `DISTRIBUTED BY HASH(${distColumns.map((c) => `\`${c}\``).join(', ')})`;
      lines.push(bucketCount ? `${dist} BUCKETS ${bucketCount}` : dist);
    } else if (distStrategy === 'RANDOM') {
      lines.push(bucketCount ? `DISTRIBUTED BY RANDOM BUCKETS ${bucketCount}` : 'DISTRIBUTED BY RANDOM');
    }

    // Sort key
    if (sortColumns.length > 0) {
      lines.push(`ORDER BY (${sortColumns.map((c) => `\`${c}\``).join(', ')})`);
    }

    // Properties
    const props: string[] = [];
    props.push(`"replication_num" = "${replicationNum}"`);
    if (compression !== 'LZ4') props.push(`"compression" = "${compression}"`);
    if (storageMedium) props.push(`"storage_medium" = "${storageMedium}"`);
    if (enableFastSchema) props.push(`"fast_schema_evolution" = "true"`);
    if (enablePersistentIndex) props.push(`"enable_persistent_index" = "true"`);

    if (props.length > 0) {
      lines.push('PROPERTIES (');
      lines.push('  ' + props.join(',\n  '));
      lines.push(')');
    }

    return lines.join('\n') + ';';
  }, [
    database, tableName, tableModel, tableComment, columns, indexes,
    distStrategy, distColumns, bucketCount, sortColumns,
    partitionType, partExprFunc, partExprGranularity, partExprColumn,
    partRangeColumn, partRangeStart, partRangeEnd, partRangeInterval,
    replicationNum, compression, storageMedium, enableFastSchema, enablePersistentIndex, keyColumns,
  ]);

  // ── Validation ─────────────────────────────────────────────────

  const canNext = (s: number): boolean => {
    switch (s) {
      case 0: return !!database && !!tableName && !!tableModel;
      case 1: return columns.some((c) => c.name && c.type) && keyColumns.length > 0;
      case 2: return distStrategy === 'RANDOM' || distColumns.length > 0;
      case 3: return !partColumnNotInKey;
      case 4: return true;
      default: return true;
    }
  };

  // ── Submit ─────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selectedEnv) return;
    setSubmitting(true);
    try {
      await createTable(selectedEnv, editedSQL);
      message.success(`Table "${database}.${tableName}" created successfully`);
      resetAll();
      onSuccess();
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step Content ───────────────────────────────────────────────

  const stepItems = [
    { title: 'Basic' },
    { title: 'Columns' },
    { title: 'Distribution' },
    { title: 'Partitioning' },
    { title: 'Properties' },
    { title: 'Review' },
  ];

  const renderStep = () => {
    switch (step) {

      // ── Step 0: Basic ──────────────────────────────────────────
      case 0:
        return (
          <Form layout="vertical">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Database" required>
                  <Select
                    value={database || undefined}
                    onChange={setDatabase}
                    placeholder="Select database"
                    showSearch
                    options={databases
                      .filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys')
                      .map((db) => ({ value: db, label: db }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Table Name" required>
                  <Input
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    placeholder="e.g. user_events"
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item label="Table Model" required>
              <Row gutter={[12, 12]}>
                {TABLE_MODELS.map((m) => (
                  <Col span={12} key={m.value}>
                    <Card
                      size="small"
                      hoverable
                      onClick={() => setTableModel(m.value)}
                      style={{
                        border: tableModel === m.value ? '2px solid #6366f1' : '1px solid #e2e8f0',
                        cursor: 'pointer',
                      }}
                    >
                      <Space direction="vertical" size={2}>
                        <Typography.Text strong style={{ color: tableModel === m.value ? '#6366f1' : undefined }}>
                          {m.label}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {m.desc}
                        </Typography.Text>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Form.Item>

            <Form.Item label="Comment">
              <Input
                value={tableComment}
                onChange={(e) => setTableComment(e.target.value)}
                placeholder="Optional table description"
              />
            </Form.Item>
          </Form>
        );

      // ── Step 1: Columns ────────────────────────────────────────
      case 1:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Alert
              type="info"
              showIcon
              message={
                tableModel === 'AGGREGATE'
                  ? 'Mark key columns (dimensions). Value columns need an aggregation function.'
                  : `Mark columns that form the ${tableModel === 'PRIMARY' ? 'primary' : tableModel === 'UNIQUE' ? 'unique' : 'duplicate'} key.`
              }
              style={{ marginBottom: 4 }}
            />

            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              <Table
                size="small"
                pagination={false}
                dataSource={columns.map((c, i) => ({ ...c, key: c.id, _idx: i }))}
                columns={[
                  {
                    title: '', width: 50,
                    render: (_: unknown, __: unknown, i: number) => (
                      <Space direction="vertical" size={0}>
                        <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveCol(i, -1)} style={{ padding: 0, height: 18 }} />
                        <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={i === columns.length - 1} onClick={() => moveCol(i, 1)} style={{ padding: 0, height: 18 }} />
                      </Space>
                    ),
                  },
                  {
                    title: 'Key', width: 50, dataIndex: 'isKey',
                    render: (v: boolean, rec: ColumnDef) => (
                      <Tooltip title="Include in table key">
                        <input type="checkbox" checked={v} onChange={(e) => updateCol(rec.id, 'isKey', e.target.checked)} />
                      </Tooltip>
                    ),
                  },
                  {
                    title: 'Name', dataIndex: 'name', width: 160,
                    render: (v: string, rec: ColumnDef) => (
                      <Input size="small" value={v} onChange={(e) => updateCol(rec.id, 'name', e.target.value)} placeholder="column_name" />
                    ),
                  },
                  {
                    title: 'Type', dataIndex: 'type', width: 180,
                    render: (v: string, rec: ColumnDef) => (
                      <Select size="small" value={v} onChange={(val) => updateCol(rec.id, 'type', val)} options={DATA_TYPES} showSearch style={{ width: '100%' }} />
                    ),
                  },
                  {
                    title: 'Null', width: 45, dataIndex: 'nullable',
                    render: (v: boolean, rec: ColumnDef) => (
                      <input type="checkbox" checked={v} onChange={(e) => updateCol(rec.id, 'nullable', e.target.checked)} />
                    ),
                  },
                  ...(tableModel === 'AGGREGATE' ? [{
                    title: 'Agg', width: 120, dataIndex: 'aggFunction' as const,
                    render: (v: string, rec: ColumnDef) => (
                      rec.isKey ? <span style={{ color: 'var(--sr-text-muted)', fontSize: 11 }}>-</span> :
                      <Select size="small" value={v || ''} onChange={(val) => updateCol(rec.id, 'aggFunction', val)} options={AGG_FUNCTIONS} style={{ width: '100%' }} />
                    ),
                  }] : []),
                  {
                    title: 'Default', width: 120, dataIndex: 'defaultVal',
                    render: (v: string, rec: ColumnDef) => (
                      <Input size="small" value={v} onChange={(e) => updateCol(rec.id, 'defaultVal', e.target.value)} placeholder="" />
                    ),
                  },
                  {
                    title: 'Comment', dataIndex: 'comment',
                    render: (v: string, rec: ColumnDef) => (
                      <Input size="small" value={v} onChange={(e) => updateCol(rec.id, 'comment', e.target.value)} placeholder="" />
                    ),
                  },
                  {
                    title: '', width: 36,
                    render: (_: unknown, rec: ColumnDef) => (
                      columns.length > 1 ? (
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeCol(rec.id)} />
                      ) : null
                    ),
                  },
                ]}
              />
            </div>

            <Button type="dashed" icon={<PlusOutlined />} onClick={addCol} style={{ borderRadius: 8 }}>
              Add Column
            </Button>

            {keyColumns.length === 0 && (
              <Alert type="warning" message="Select at least one key column by checking the Key checkbox." showIcon />
            )}

            {keysNeedReorder && (
              <Alert
                type="info"
                showIcon
                message="Key columns will be moved to the top of the schema"
                description={`StarRocks requires key columns to come first. The generated DDL lists ${keyColumns.map((c) => c.name).filter(Boolean).join(', ')} before the other columns — the order shown here is left as you set it.`}
              />
            )}
          </div>
        );

      // ── Step 2: Distribution ───────────────────────────────────
      case 2:
        return (
          <Form layout="vertical">
            <Form.Item label="Distribution Strategy" required>
              <Row gutter={12}>
                <Col span={12}>
                  <Card
                    size="small" hoverable
                    onClick={() => setDistStrategy('HASH')}
                    style={{ border: distStrategy === 'HASH' ? '2px solid #6366f1' : '1px solid #e2e8f0', cursor: 'pointer' }}
                  >
                    <Typography.Text strong style={{ color: distStrategy === 'HASH' ? '#6366f1' : undefined }}>Hash Distribution</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Distribute by hash of specific columns. Better query performance.
                    </Typography.Text>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card
                    size="small" hoverable
                    onClick={() => { if (tableModel === 'DUPLICATE') setDistStrategy('RANDOM'); }}
                    style={{
                      border: distStrategy === 'RANDOM' ? '2px solid #6366f1' : '1px solid #e2e8f0',
                      cursor: tableModel === 'DUPLICATE' ? 'pointer' : 'not-allowed',
                      opacity: tableModel === 'DUPLICATE' ? 1 : 0.5,
                    }}
                  >
                    <Typography.Text strong style={{ color: distStrategy === 'RANDOM' ? '#6366f1' : undefined }}>Random Distribution</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      No bucketing key required. Only for Duplicate Key tables.
                    </Typography.Text>
                  </Card>
                </Col>
              </Row>
            </Form.Item>

            {distStrategy === 'HASH' && (
              <Form.Item label="Distribution Columns" required>
                <Select
                  mode="multiple"
                  value={distColumns}
                  onChange={setDistColumns}
                  placeholder="Select columns for hash distribution"
                  options={colNames.map((c) => ({ value: c, label: c }))}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Choose high-cardinality columns (e.g. IDs) for even distribution.
                </Typography.Text>
              </Form.Item>
            )}

            <Form.Item
              label={
                <Space>
                  Bucket Count
                  <Tooltip title="Leave empty for automatic bucket sizing (recommended). StarRocks will determine the optimal count based on data volume.">
                    <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                  </Tooltip>
                </Space>
              }
            >
              <InputNumber
                value={bucketCount}
                onChange={(v) => setBucketCount(v)}
                min={1} max={512}
                placeholder="Auto (recommended)"
                style={{ width: 200 }}
              />
            </Form.Item>

            <Divider />

            <Form.Item
              label={
                <Space>
                  Sort Key (ORDER BY)
                  <Tooltip title="Define columns for data ordering on disk. Improves query performance for range/prefix queries. Optional.">
                    <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                  </Tooltip>
                </Space>
              }
            >
              <Select
                mode="multiple"
                value={sortColumns}
                onChange={setSortColumns}
                placeholder="Optional - columns to order data by"
                options={colNames.map((c) => ({ value: c, label: c }))}
              />
            </Form.Item>
          </Form>
        );

      // ── Step 3: Partitioning ───────────────────────────────────
      case 3:
        return (
          <Form layout="vertical">
            <Form.Item label="Partition Strategy">
              <Row gutter={[12, 12]}>
                {([
                  { value: 'NONE', label: 'No Partitioning', desc: 'Entire table is a single partition. Simplest option.' },
                  { value: 'EXPR', label: 'Expression Partition', desc: 'Auto-create partitions based on time function (recommended).' },
                  { value: 'RANGE', label: 'Range Partition', desc: 'Batch-create partitions with start/end/interval.' },
                ] as const).map((p) => (
                  <Col span={8} key={p.value}>
                    <Card
                      size="small" hoverable
                      onClick={() => setPartitionType(p.value)}
                      style={{ border: partitionType === p.value ? '2px solid #6366f1' : '1px solid #e2e8f0', cursor: 'pointer', height: '100%' }}
                    >
                      <Typography.Text strong style={{ color: partitionType === p.value ? '#6366f1' : undefined }}>{p.label}</Typography.Text>
                      <br />
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{p.desc}</Typography.Text>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Form.Item>

            {partColumnNotInKey && (
              <Alert
                type="error"
                showIcon
                message={`Partition column "${activePartColumn}" must be part of the ${tableModel === 'PRIMARY' ? 'Primary' : 'Unique'} Key. Go back to Columns step and mark it as a key column.`}
                style={{ marginBottom: 12 }}
              />
            )}

            {partitionType === 'EXPR' && (
              <>
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="Function">
                      <Select value={partExprFunc} onChange={setPartExprFunc} options={[
                        { value: 'date_trunc', label: 'date_trunc' },
                        { value: 'time_slice', label: 'time_slice' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="Granularity">
                      <Select value={partExprGranularity} onChange={setPartExprGranularity} options={[
                        { value: 'hour', label: 'Hour' },
                        { value: 'day', label: 'Day' },
                        { value: 'week', label: 'Week' },
                        { value: 'month', label: 'Month' },
                        { value: 'year', label: 'Year' },
                      ]} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="Column">
                      <Select
                        value={partExprColumn || undefined}
                        onChange={setPartExprColumn}
                        placeholder="Date column"
                        options={dateColumns.map((c) => ({ value: c.name, label: `${c.name} (${c.type})` }))}
                      />
                      {dateColumns.length === 0 && (
                        <Typography.Text type="danger" style={{ fontSize: 11 }}>
                          Add a DATE or DATETIME column first.
                        </Typography.Text>
                      )}
                    </Form.Item>
                  </Col>
                </Row>
              </>
            )}

            {partitionType === 'RANGE' && (
              <>
                <Form.Item label="Partition Column">
                  <Select
                    value={partRangeColumn || undefined}
                    onChange={setPartRangeColumn}
                    placeholder="Select column"
                    options={dateColumns.map((c) => ({ value: c.name, label: `${c.name} (${c.type})` }))}
                  />
                </Form.Item>
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="Start">
                      <Input value={partRangeStart} onChange={(e) => setPartRangeStart(e.target.value)} placeholder="2024-01-01" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="End">
                      <Input value={partRangeEnd} onChange={(e) => setPartRangeEnd(e.target.value)} placeholder="2025-01-01" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="Interval">
                      <Select value={partRangeInterval} onChange={setPartRangeInterval} options={[
                        { value: '1 DAY', label: '1 Day' },
                        { value: '1 WEEK', label: '1 Week' },
                        { value: '1 MONTH', label: '1 Month' },
                        { value: '3 MONTH', label: '3 Months' },
                        { value: '1 YEAR', label: '1 Year' },
                      ]} />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            )}
          </Form>
        );

      // ── Step 4: Indexes & Properties ───────────────────────────
      case 4:
        return (
          <Form layout="vertical">
            <Typography.Text strong>Indexes</Typography.Text>
            <div style={{ marginTop: 8, marginBottom: 16 }}>
              {indexes.map((idx, i) => (
                <Row gutter={12} key={idx.id} style={{ marginBottom: 8 }}>
                  <Col span={6}>
                    <Input size="small" value={idx.name} onChange={(e) => {
                      const arr = [...indexes]; arr[i] = { ...arr[i], name: e.target.value }; setIndexes(arr);
                    }} placeholder="Index name" />
                  </Col>
                  <Col span={6}>
                    <Select size="small" value={idx.column || undefined} onChange={(v) => {
                      const arr = [...indexes]; arr[i] = { ...arr[i], column: v }; setIndexes(arr);
                    }} placeholder="Column" options={colNames.map((c) => ({ value: c, label: c }))} style={{ width: '100%' }} />
                  </Col>
                  <Col span={5}>
                    <Select size="small" value={idx.type} onChange={(v) => {
                      const arr = [...indexes]; arr[i] = { ...arr[i], type: v }; setIndexes(arr);
                    }} options={[
                      { value: 'BITMAP', label: 'BITMAP' },
                      { value: 'BLOOM_FILTER', label: 'BLOOM FILTER' },
                    ]} style={{ width: '100%' }} />
                  </Col>
                  <Col span={5}>
                    <Input size="small" value={idx.comment} onChange={(e) => {
                      const arr = [...indexes]; arr[i] = { ...arr[i], comment: e.target.value }; setIndexes(arr);
                    }} placeholder="Comment" />
                  </Col>
                  <Col span={2}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setIndexes(indexes.filter((_, j) => j !== i))} />
                  </Col>
                </Row>
              ))}
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => setIndexes([...indexes, newIndex()])} style={{ borderRadius: 6 }}>
                Add Index
              </Button>
            </div>

            <Divider />

            <Typography.Text strong>Table Properties</Typography.Text>
            <Row gutter={16} style={{ marginTop: 12 }}>
              <Col span={8}>
                <Form.Item label="Replication Num">
                  <InputNumber value={replicationNum} onChange={(v) => setReplicationNum(v || envReplicationNum)} min={1} max={5} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Compression">
                  <Select value={compression} onChange={setCompression} options={COMPRESSION_OPTIONS} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Storage Medium">
                  <Select value={storageMedium} onChange={setStorageMedium} allowClear placeholder="Auto" options={[
                    { value: 'SSD', label: 'SSD' },
                    { value: 'HDD', label: 'HDD' },
                  ]} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item>
              <Space>
                <Switch checked={enableFastSchema} onChange={setEnableFastSchema} size="small" />
                <span>Fast Schema Evolution</span>
                <Tooltip title="Accelerate ADD/DROP column operations by avoiding full data rewrite">
                  <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                </Tooltip>
              </Space>
            </Form.Item>
            <Form.Item>
              <Space>
                <Switch checked={enablePersistentIndex} onChange={setEnablePersistentIndex} size="small" />
                <span>Persistent Index</span>
                <Tooltip title="Enable persistent index for Primary Key tables. Improves query performance by persisting the primary key index to disk.">
                  <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                </Tooltip>
              </Space>
            </Form.Item>
          </Form>
        );

      // ── Step 5: Review ─────────────────────────────────────────
      case 5:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Row gutter={16}>
              <Col span={8}>
                <Card size="small">
                  <Typography.Text type="secondary">Table</Typography.Text>
                  <div><Typography.Text strong>{database}.{tableName}</Typography.Text></div>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Typography.Text type="secondary">Model</Typography.Text>
                  <div><Tag color="blue">{tableModel} KEY</Tag></div>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Typography.Text type="secondary">Columns</Typography.Text>
                  <div><Typography.Text strong>{columns.filter((c) => c.name).length}</Typography.Text> ({keyColumns.length} key)</div>
                </Card>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={8}>
                <Card size="small">
                  <Typography.Text type="secondary">Distribution</Typography.Text>
                  <div>{distStrategy}{distStrategy === 'HASH' ? ` (${distColumns.join(', ')})` : ''}</div>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Typography.Text type="secondary">Partitioning</Typography.Text>
                  <div>{partitionType === 'NONE' ? 'None' : partitionType === 'EXPR' ? `${partExprFunc}(${partExprGranularity}, ${partExprColumn})` : `Range on ${partRangeColumn}`}</div>
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Typography.Text type="secondary">Replicas / Compression</Typography.Text>
                  <div>{replicationNum}x / {compression}</div>
                </Card>
              </Col>
            </Row>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Typography.Text strong>Generated SQL</Typography.Text>
                <Space size={4}>
                  <Button type="text" size="small" onClick={() => setEditedSQL(generatedSQL)}>Reset</Button>
                  <Button
                    type="text" size="small" icon={<CopyOutlined />}
                    onClick={() => { navigator.clipboard.writeText(editedSQL); message.success('SQL copied to clipboard'); }}
                  >Copy</Button>
                </Space>
              </div>
              <Input.TextArea
                value={editedSQL}
                onChange={(e) => setEditedSQL(e.target.value)}
                style={{
                  background: 'var(--sr-code-bg)',
                  color: 'var(--sr-code-fg)',
                  padding: 16,
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontFamily: 'monospace',
                  border: '1px solid var(--sr-code-border)',
                }}
                autoSize={{ minRows: 8, maxRows: 16 }}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Modal
      title="Create Table"
      open={open}
      onCancel={() => { resetAll(); onClose(); }}
      width={920}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step > 0 && (
              <Button onClick={() => setStep(step - 1)}>Back</Button>
            )}
          </div>
          <Space>
            <Button onClick={() => { resetAll(); onClose(); }}>Cancel</Button>
            {step < 5 ? (
              <Button type="primary" disabled={!canNext(step)} onClick={() => {
                const nextStep = step + 1;
                if (nextStep === 5) setEditedSQL(generatedSQL);
                setStep(nextStep);
              }}>
                Next
              </Button>
            ) : (
              <Button type="primary" loading={submitting} onClick={handleSubmit}>
                Create Table
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Steps current={step} items={stepItems} size="small" style={{ margin: '16px 0 28px' }} />
      {renderStep()}
    </Modal>
  );
}
