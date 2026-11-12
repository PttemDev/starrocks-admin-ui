import { useState, useEffect } from 'react';
import {
  Modal, Steps, Form, Input, Select, Button, Space, Alert, Typography,
  InputNumber, Divider, Tooltip, Switch, Row, Col, message, Tag,
} from 'antd';
import {
  DatabaseOutlined,
  TableOutlined,
  CloudServerOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  CopyOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { fetchTables, fetchColumns, executeRoutineLoadCommand } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import type { ColumnInfo } from '../../api/types';
import { quoteIdent, separator, sqlProp } from '../../utils/routineLoad';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  databases: string[];
  initialDb?: string;
}

interface WizardState {
  // Step 1 - Target
  jobName: string;
  database: string;
  table: string;
  columns: string[];  // subset of table columns to load into
  // Step 2 - Source
  sourceType: 'KAFKA';
  kafkaBrokers: string;
  kafkaTopic: string;
  kafkaPartitions: string; // e.g. "0,1,2" or empty for all
  kafkaOffsets: string; // e.g. "OFFSET_BEGINNING" or specific offsets
  kafkaGroup: string;
  // Step 3 - Format
  dataFormat: 'JSON' | 'CSV';
  jsonPaths: string; // JSON paths expression
  csvColumnSeparator: string;
  csvRowDelimiter: string;
  stripOuterArray: boolean;
  // Step 4 - Options
  maxErrorNumber: number;
  maxBatchInterval: number; // seconds
  maxBatchRows: number;
  desiredConcurrentNumber: number;
  strictMode: boolean;
  timezone: string;
}

const defaultState: WizardState = {
  jobName: '',
  database: '',
  table: '',
  columns: [],
  sourceType: 'KAFKA',
  kafkaBrokers: '',
  kafkaTopic: '',
  kafkaPartitions: '',
  kafkaOffsets: 'OFFSET_BEGINNING',
  kafkaGroup: '',
  dataFormat: 'JSON',
  jsonPaths: '',
  csvColumnSeparator: '\\t',
  csvRowDelimiter: '\\n',
  stripOuterArray: false,
  maxErrorNumber: 1000,
  maxBatchInterval: 10,
  maxBatchRows: 200000,
  desiredConcurrentNumber: 3,
  strictMode: false,
  timezone: '',
};

function generateSQL(state: WizardState): string {
  const lines: string[] = [];

  // Job header
  lines.push(`CREATE ROUTINE LOAD ${quoteIdent(state.database)}.${quoteIdent(state.jobName)}`);
  lines.push(`ON ${quoteIdent(state.table)}`);

  // Load properties (optional): CSV separators, then the column list
  const load: string[] = [];
  if (state.dataFormat === 'CSV') {
    if (state.csvColumnSeparator) load.push(`COLUMNS TERMINATED BY ${separator(state.csvColumnSeparator)}`);
    if (state.csvRowDelimiter) load.push(`ROWS TERMINATED BY ${separator(state.csvRowDelimiter)}`);
  }
  if (state.columns.length > 0) {
    load.push(`COLUMNS(${state.columns.map(quoteIdent).join(', ')})`);
  }
  if (load.length > 0) lines.push(load.join(',\n'));

  // Properties — values are single-quoted SQL strings, so JSON paths full of
  // double quotes ("$.id") no longer break the statement.
  const props: string[] = [];
  props.push(sqlProp('desired_concurrent_number', String(state.desiredConcurrentNumber)));
  props.push(sqlProp('max_error_number', String(state.maxErrorNumber)));
  props.push(sqlProp('max_batch_interval', String(state.maxBatchInterval)));
  props.push(sqlProp('max_batch_rows', String(state.maxBatchRows)));
  if (state.strictMode) props.push(sqlProp('strict_mode', 'true'));
  if (state.timezone) props.push(sqlProp('timezone', state.timezone));
  props.push(sqlProp('format', state.dataFormat.toLowerCase()));
  if (state.dataFormat === 'JSON') {
    if (state.jsonPaths.trim()) props.push(sqlProp('jsonpaths', state.jsonPaths.trim()));
    if (state.stripOuterArray) props.push(sqlProp('strip_outer_array', 'true'));
  }

  lines.push(`PROPERTIES (`);
  lines.push(props.join(',\n'));
  lines.push(`)`);

  // Data source
  const kafkaProps: string[] = [];
  kafkaProps.push(sqlProp('kafka_broker_list', state.kafkaBrokers));
  kafkaProps.push(sqlProp('kafka_topic', state.kafkaTopic));
  if (state.kafkaPartitions) {
    kafkaProps.push(sqlProp('kafka_partitions', state.kafkaPartitions));
    // kafka_offsets is per listed partition; a single default goes to property.kafka_default_offsets.
    if (state.kafkaOffsets) {
      const n = state.kafkaPartitions.split(',').filter((p) => p.trim()).length;
      kafkaProps.push(sqlProp('kafka_offsets', Array(n).fill(state.kafkaOffsets).join(',')));
    }
  } else if (state.kafkaOffsets) {
    kafkaProps.push(sqlProp('property.kafka_default_offsets', state.kafkaOffsets));
  }
  if (state.kafkaGroup) kafkaProps.push(sqlProp('property.group.id', state.kafkaGroup));
  lines.push(`FROM KAFKA (`);
  lines.push(kafkaProps.join(',\n'));
  lines.push(`);`);

  return lines.join('\n');
}

export default function CreateRoutineLoadWizard({
  open, onClose, onSuccess, databases, initialDb,
}: Props) {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({ ...defaultState });
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [colLoading, setColLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editedSQL, setEditedSQL] = useState<string>('');

  // Reset on open
  useEffect(() => {
    if (open) {
      setState({ ...defaultState, database: initialDb || '' });
      setStep(0);
      setError(null);
      if (initialDb && selectedEnv) {
        setTableLoading(true);
        fetchTables(selectedEnv, initialDb)
          .then(setTables)
          .catch(() => {})
          .finally(() => setTableLoading(false));
      }
    }
  }, [open, initialDb, selectedEnv]);

  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }));

  // Load tables when db changes
  const onDbChange = (db: string) => {
    update({ database: db, table: '', columns: [] });
    setColumns([]);
    if (db && selectedEnv) {
      setTableLoading(true);
      fetchTables(selectedEnv, db)
        .then(setTables)
        .catch(() => setTables([]))
        .finally(() => setTableLoading(false));
    } else {
      setTables([]);
    }
  };

  // Load columns when table changes
  const onTableChange = (table: string) => {
    update({ table, columns: [] });
    if (table && state.database && selectedEnv) {
      setColLoading(true);
      fetchColumns(selectedEnv, state.database, table)
        .then(setColumns)
        .catch(() => setColumns([]))
        .finally(() => setColLoading(false));
    } else {
      setColumns([]);
    }
  };

  const canNext = (): boolean => {
    switch (step) {
      case 0:
        return !!(state.jobName && state.database && state.table);
      case 1:
        return !!(state.kafkaBrokers && state.kafkaTopic);
      case 2:
        return true;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleExecute = async () => {
    if (!selectedEnv) return;
    setExecuting(true);
    setError(null);
    try {
      await executeRoutineLoadCommand(selectedEnv, editedSQL);
      message.success(`Routine load "${state.jobName}" created successfully!`);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  };

  const steps = [
    {
      title: 'Target',
      icon: <DatabaseOutlined />,
      description: 'Where to load data',
    },
    {
      title: 'Source',
      icon: <CloudServerOutlined />,
      description: 'Kafka connection',
    },
    {
      title: 'Format',
      icon: <SettingOutlined />,
      description: 'Data format',
    },
    {
      title: 'Review',
      icon: <CheckCircleOutlined />,
      description: 'Confirm & create',
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#6366f1' }} />
          <span>Create Routine Load Job</span>
        </Space>
      }
      width={780}
      footer={null}
      destroyOnClose
    >
      <Steps
        current={step}
        size="small"
        items={steps}
        style={{ margin: '16px 0 28px' }}
      />

      {/* Step 0: Target */}
      {step === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Choose the StarRocks database and table where incoming data will be loaded."
            style={{ borderRadius: 8 }}
          />
          <Form layout="vertical" requiredMark="optional">
            <Form.Item label="Job Name" required tooltip="A unique name for this routine load job. Used to identify, pause, resume, or stop the job.">
              <Input
                value={state.jobName}
                onChange={(e) => update({ jobName: e.target.value })}
                placeholder="e.g. kafka_events_loader"
                maxLength={64}
              />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="Database" required tooltip="Target database where data will be loaded.">
                  <Select
                    value={state.database || undefined}
                    onChange={onDbChange}
                    placeholder="Select database"
                    showSearch
                    filterOption={(input, option) =>
                      String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={databases
                      .filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys')
                      .map((db) => ({ value: db, label: db }))
                    }
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Table" required tooltip="Target table within the database. The table must already exist.">
                  <Select
                    value={state.table || undefined}
                    onChange={onTableChange}
                    placeholder={state.database ? 'Select table' : 'Select database first'}
                    disabled={!state.database}
                    loading={tableLoading}
                    showSearch
                    filterOption={(input, option) =>
                      String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={tables.map((t) => ({ value: t, label: t }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="Columns"
              tooltip="Select specific columns to load into. Leave empty to load all columns (the Kafka message must match the table schema)."
            >
              <Select
                mode="multiple"
                value={state.columns}
                onChange={(cols) => update({ columns: cols })}
                placeholder={columns.length > 0 ? 'All columns (default)' : 'Select table first'}
                disabled={columns.length === 0}
                loading={colLoading}
                maxTagCount={6}
                options={columns.map((c) => ({
                  value: c.name,
                  label: (
                    <Space size={4}>
                      <span>{c.name}</span>
                      <Tag style={{ fontSize: 10, lineHeight: '16px', margin: 0, borderRadius: 3 }}>{c.type}</Tag>
                    </Space>
                  ),
                }))}
              />
            </Form.Item>
          </Form>
        </div>
      )}

      {/* Step 1: Source */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Configure the Kafka source that StarRocks will consume messages from."
            style={{ borderRadius: 8 }}
          />
          <Form layout="vertical" requiredMark="optional">
            <Form.Item
              label="Kafka Brokers"
              required
              tooltip="Comma-separated list of Kafka broker addresses. Example: broker1:9092,broker2:9092"
            >
              <Input
                value={state.kafkaBrokers}
                onChange={(e) => {
                  const v = e.target.value.replace(/[;\s]+/g, ',').replace(/,{2,}/g, ',');
                  update({ kafkaBrokers: v });
                }}
                placeholder="broker1:9092,broker2:9092"
              />
            </Form.Item>
            <Form.Item
              label="Kafka Topic"
              required
              tooltip="The Kafka topic to consume messages from."
            >
              <Input
                value={state.kafkaTopic}
                onChange={(e) => update({ kafkaTopic: e.target.value })}
                placeholder="e.g. events_topic"
              />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="Partitions"
                  tooltip="Comma-separated partition IDs to consume. Leave empty to consume all partitions."
                >
                  <Input
                    value={state.kafkaPartitions}
                    onChange={(e) => update({ kafkaPartitions: e.target.value })}
                    placeholder="All partitions (default)"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="Starting Offset"
                  tooltip="Where to start consuming. OFFSET_BEGINNING reads from the start, OFFSET_END starts from latest."
                >
                  <Select
                    value={state.kafkaOffsets}
                    onChange={(v) => update({ kafkaOffsets: v })}
                    options={[
                      { value: 'OFFSET_BEGINNING', label: 'From beginning' },
                      { value: 'OFFSET_END', label: 'From latest (end)' },
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="Consumer Group ID"
              tooltip="Kafka consumer group ID. If set, allows offset tracking and consumer coordination."
            >
              <Input
                value={state.kafkaGroup}
                onChange={(e) => update({ kafkaGroup: e.target.value })}
                placeholder="Optional - leave empty for auto-generated"
              />
            </Form.Item>
          </Form>
        </div>
      )}

      {/* Step 2: Format */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Define how Kafka messages should be parsed before loading into the table."
            style={{ borderRadius: 8 }}
          />
          <Form layout="vertical">
            <Form.Item label="Data Format" tooltip="Format of the messages in the Kafka topic.">
              <Select
                value={state.dataFormat}
                onChange={(v) => update({ dataFormat: v })}
                options={[
                  { value: 'JSON', label: 'JSON - Each message is a JSON object' },
                  { value: 'CSV', label: 'CSV - Each message is a delimited row' },
                ]}
              />
            </Form.Item>

            {state.dataFormat === 'JSON' && (
              <>
                <Form.Item
                  label="JSON Paths"
                  tooltip='Optional. Specify JSON field paths to extract. Example: ["$.id","$.name","$.timestamp"]. Leave empty if JSON keys match column names exactly.'
                >
                  <Input.TextArea
                    value={state.jsonPaths}
                    onChange={(e) => update({ jsonPaths: e.target.value })}
                    placeholder='e.g. ["$.id","$.name","$.created_at"]  (leave empty if keys match columns)'
                    rows={2}
                  />
                </Form.Item>
                <Form.Item tooltip="Enable if each Kafka message contains a JSON array and you want each element loaded as a separate row.">
                  <Space>
                    <Switch
                      checked={state.stripOuterArray}
                      onChange={(v) => update({ stripOuterArray: v })}
                    />
                    <span>Strip outer array</span>
                    <Tooltip title="When enabled, if a message is [obj1, obj2, obj3], each object becomes a separate row. Useful for batched messages.">
                      <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                    </Tooltip>
                  </Space>
                </Form.Item>
              </>
            )}

            {state.dataFormat === 'CSV' && (
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="Column Separator" tooltip="Character used to separate columns. Default is tab (\\t).">
                    <Input
                      value={state.csvColumnSeparator}
                      onChange={(e) => update({ csvColumnSeparator: e.target.value })}
                      placeholder="\\t"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Row Delimiter" tooltip="Character used to separate rows. Default is newline (\\n).">
                    <Input
                      value={state.csvRowDelimiter}
                      onChange={(e) => update({ csvRowDelimiter: e.target.value })}
                      placeholder="\\n"
                    />
                  </Form.Item>
                </Col>
              </Row>
            )}

            <Divider style={{ margin: '8px 0 16px' }}>Performance Settings</Divider>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Batch Interval" tooltip="Maximum seconds between two batches. StarRocks accumulates data for this duration before loading.">
                  <InputNumber
                    value={state.maxBatchInterval}
                    onChange={(v) => update({ maxBatchInterval: v || 10 })}
                    min={1}
                    max={600}
                    addonAfter="sec"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Batch Rows" tooltip="Maximum rows per batch. When reached, a load is triggered even if the batch interval hasn't elapsed.">
                  <InputNumber
                    value={state.maxBatchRows}
                    onChange={(v) => update({ maxBatchRows: v || 200000 })}
                    min={1000}
                    max={10000000}
                    step={10000}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Concurrency" tooltip="Number of parallel load tasks. Higher values increase throughput but use more cluster resources.">
                  <InputNumber
                    value={state.desiredConcurrentNumber}
                    onChange={(v) => update({ desiredConcurrentNumber: v || 3 })}
                    min={1}
                    max={64}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item label="Max Error Rows" tooltip="Maximum number of error rows allowed before the job is paused. Set higher for lenient loading.">
                  <InputNumber
                    value={state.maxErrorNumber}
                    onChange={(v) => update({ maxErrorNumber: v || 1000 })}
                    min={0}
                    max={1000000}
                    step={100}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item tooltip="When enabled, rows with type conversion errors are rejected instead of loaded with default values.">
                  <Space style={{ marginTop: 30 }}>
                    <Switch
                      checked={state.strictMode}
                      onChange={(v) => update({ strictMode: v })}
                    />
                    <span>Strict mode</span>
                  </Space>
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label="Timezone" tooltip="Timezone for the load job. Leave empty to use system timezone.">
                  <Select
                    value={state.timezone || undefined}
                    onChange={(v) => update({ timezone: v || '' })}
                    placeholder="Server default"
                    allowClear
                    onClear={() => update({ timezone: '' })}
                    showSearch
                    filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                    options={[
                      { value: 'UTC', label: 'UTC' },
                      { value: 'Europe/Istanbul', label: 'Europe/Istanbul (UTC+3)' },
                      { value: 'Europe/London', label: 'Europe/London (UTC+0/+1)' },
                      { value: 'Europe/Berlin', label: 'Europe/Berlin (UTC+1/+2)' },
                      { value: 'Europe/Moscow', label: 'Europe/Moscow (UTC+3)' },
                      { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
                      { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
                      { value: 'Asia/Kolkata', label: 'Asia/Kolkata (UTC+5:30)' },
                      { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4)' },
                      { value: 'America/New_York', label: 'America/New_York (UTC-5/-4)' },
                      { value: 'America/Chicago', label: 'America/Chicago (UTC-6/-5)' },
                      { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8/-7)' },
                      { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (UTC-3)' },
                      { value: 'Pacific/Auckland', label: 'Pacific/Auckland (UTC+12/+13)' },
                      { value: 'Australia/Sydney', label: 'Australia/Sydney (UTC+10/+11)' },
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary cards */}
          <Row gutter={[12, 12]}>
            <Col span={8}>
              <div style={{ background: 'var(--sr-card-alt)', borderRadius: 8, padding: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Target
                </Typography.Text>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{state.database}.{state.table}</div>
                <div style={{ fontSize: 12, color: 'var(--sr-text-secondary)' }}>
                  {state.columns.length > 0 ? `${state.columns.length} columns` : 'All columns'}
                </div>
              </div>
            </Col>
            <Col span={8}>
              <div style={{ background: 'var(--sr-card-alt)', borderRadius: 8, padding: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Source
                </Typography.Text>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{state.kafkaTopic}</div>
                <div style={{ fontSize: 12, color: 'var(--sr-text-secondary)' }}>
                  {state.kafkaBrokers.split(',').length} broker{state.kafkaBrokers.split(',').length > 1 ? 's' : ''}
                </div>
              </div>
            </Col>
            <Col span={8}>
              <div style={{ background: 'var(--sr-card-alt)', borderRadius: 8, padding: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Format
                </Typography.Text>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{state.dataFormat}</div>
                <div style={{ fontSize: 12, color: 'var(--sr-text-secondary)' }}>
                  {state.desiredConcurrentNumber}x concurrency, {state.maxBatchInterval}s interval
                </div>
              </div>
            </Col>
          </Row>

          {/* Generated SQL (editable) */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>Generated SQL</Typography.Text>
              <Space size={4}>
                <Tooltip title="Reset to generated SQL">
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setEditedSQL(generateSQL(state))}
                  >
                    Reset
                  </Button>
                </Tooltip>
                <Tooltip title="Copy SQL to clipboard">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(editedSQL);
                      message.success('SQL copied to clipboard');
                    }}
                  >
                    Copy
                  </Button>
                </Tooltip>
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
                fontSize: 12,
                lineHeight: 1.6,
                fontFamily: 'monospace',
                border: '1px solid var(--sr-code-border)',
              }}
              autoSize={{ minRows: 8, maxRows: 16 }}
            />
          </div>

          {error && (
            <Alert
              type="error"
              message="Execution Failed"
              description={error}
              showIcon
              closable
              onClose={() => setError(null)}
              style={{ borderRadius: 8 }}
            />
          )}
        </div>
      )}

      {/* Footer Navigation */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid #f1f5f9',
        }}
      >
        <Button onClick={onClose}>Cancel</Button>
        <Space>
          {step > 0 && (
            <Button onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < 3 && (
            <Button
              type="primary"
              onClick={() => {
                const nextStep = step + 1;
                if (nextStep === 3) setEditedSQL(generateSQL(state));
                setStep(nextStep);
              }}
              disabled={!canNext()}
            >
              Next
            </Button>
          )}
          {step === 3 && (
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={executing}
              onClick={handleExecute}
            >
              Create Routine Load
            </Button>
          )}
        </Space>
      </div>
    </Modal>
  );
}
