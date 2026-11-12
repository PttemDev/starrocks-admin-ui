import { useState, useMemo, useEffect, useCallback, type ReactNode } from 'react';
import {
  Modal, Steps, Button, Form, Input, Select, Space, Typography,
  InputNumber, Row, Col, Alert, Divider, Radio, Tooltip, Card, Upload, Progress,
  DatePicker, Switch, Table, AutoComplete, Tag,
} from 'antd';
import { Editor } from '@monaco-editor/react';
import {
  CloudServerOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  SettingOutlined,
  CodeOutlined,
  CopyOutlined,
  SwapOutlined,
  InfoCircleOutlined,
  UploadOutlined,
  InboxOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { executeBatchLoad, streamLoad, createScheduledTask, createPipe, createTable, runQuery, fetchDatabases, fetchTables, fetchColumns } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { message } from 'antd';
import type { ColumnInfo } from '../../api/types';
import CreateTableWizard from '../Tables/CreateTableWizard';
import { useTheme } from '../../hooks/useTheme';

// ── Types ─────────────────────────────────────────────────────────

type SourceType = 's3' | 'gcs' | 'hdfs' | 'table' | 'upload';
type LoadMode = 'once' | 'task' | 'pipe';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  databases: string[];
  initialDb?: string;
  initialMode?: LoadMode;
}

const FILE_FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'parquet', label: 'Parquet' },
  { value: 'orc', label: 'ORC' },
];

type StepKey = 'source' | 'target' | 'preview' | 'options' | 'review';

const STEP_META: Record<StepKey, { title: string; icon: ReactNode }> = {
  source: { title: 'Source', icon: <CloudServerOutlined /> },
  target: { title: 'Target & Format', icon: <DatabaseOutlined /> },
  preview: { title: 'Preview & Schema', icon: <EyeOutlined /> },
  options: { title: 'Options', icon: <SettingOutlined /> },
  review: { title: 'Review', icon: <CodeOutlined /> },
};

// ── Component ─────────────────────────────────────────────────────

export default function BatchLoadWizard({ open, onClose, onSuccess, databases, initialDb, initialMode }: Props) {
  const { isDark } = useTheme();
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const environments = useEnvStore((s) => s.environments);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Source
  const [sourceType, setSourceType] = useState<SourceType>('s3');
  // S3
  const [s3Path, setS3Path] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  // GCS (Google Cloud Storage) — native gs://; the cluster authenticates via
  // core-site.xml (fs.gs.auth.* + service-account JSON keyfile), so no per-query creds.
  const [gcsPath, setGcsPath] = useState('');
  // HDFS
  const [hdfsPath, setHdfsPath] = useState('');
  const [hdfsUser, setHdfsUser] = useState('');
  // Table (INSERT INTO SELECT)
  const [sourceDb, setSourceDb] = useState('');
  const [sourceTable, setSourceTable] = useState('');
  const [sourceWhere, setSourceWhere] = useState('');
  const [sourceTables, setSourceTables] = useState<string[]>([]);
  // File Upload (HTTP Stream Load)
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadPercent, setUploadPercent] = useState(0);
  // Create Table sub-wizard
  const [createTableOpen, setCreateTableOpen] = useState(false);
  // Submit error
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 2: Target & Format
  const [targetDb, setTargetDb] = useState(initialDb || '');
  const [targetTable, setTargetTable] = useState('');
  const [targetTables, setTargetTables] = useState<string[]>([]);
  const [targetColumns, setTargetColumns] = useState<ColumnInfo[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [fileFormat, setFileFormat] = useState('csv');
  const [csvDelimiter, setCsvDelimiter] = useState(',');
  const [csvSkipHeader, setCsvSkipHeader] = useState(0);
  const [csvEnclose, setCsvEnclose] = useState('"');
  const [csvEscape, setCsvEscape] = useState('\\');
  const [jsonPaths, setJsonPaths] = useState('');
  const [jsonRoot, setJsonRoot] = useState('');

  // Step 3: Options
  const [loadLabel, setLoadLabel] = useState('');
  const [timeout, setTimeout] = useState(3600);
  const [maxFilterRatio, setMaxFilterRatio] = useState(0);
  const [timezone, setTimezone] = useState('');
  const [strictMode, setStrictMode] = useState(false);
  // Load mode: one-time, scheduled task (SUBMIT TASK), or continuous pipe (CREATE PIPE)
  const [loadMode, setLoadMode] = useState<LoadMode>('once');
  // Scheduled task
  const [scheduleEvery, setScheduleEvery] = useState(1);
  const [scheduleUnit, setScheduleUnit] = useState<'MINUTE' | 'HOUR' | 'DAY'>('DAY');
  const [scheduleStart, setScheduleStart] = useState('');
  const [taskName, setTaskName] = useState('');
  // Continuous pipe
  const [pipeName, setPipeName] = useState('');
  const [autoIngest, setAutoIngest] = useState(true);
  const [pollInterval, setPollInterval] = useState(300);

  // Preview & schema (file sources)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [createTableEnabled, setCreateTableEnabled] = useState(false);
  const [createTableSql, setCreateTableSql] = useState('');
  const [inferLoading, setInferLoading] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);
  const [showQuery, setShowQuery] = useState(false);
  // Table model for the inferred CREATE TABLE: Duplicate (keeps dups) vs Primary Key (dedup/upsert)
  const [tableModel, setTableModel] = useState<'duplicate' | 'primary'>('duplicate');
  const [keyCols, setKeyCols] = useState<string[]>([]);
  const [inferredCols, setInferredCols] = useState<{ name: string; type: string; nullable: boolean }[]>([]);

  // ── Data loading ────────────────────────────────────────────────

  useEffect(() => {
    if (open && selectedEnv && sourceDb && sourceType === 'table') {
      fetchTables(selectedEnv, sourceDb).then(setSourceTables).catch(() => setSourceTables([]));
    }
  }, [open, selectedEnv, sourceDb, sourceType]);

  useEffect(() => {
    if (open && selectedEnv && targetDb) {
      fetchTables(selectedEnv, targetDb).then(setTargetTables).catch(() => setTargetTables([]));
    }
  }, [open, selectedEnv, targetDb]);

  useEffect(() => {
    if (open && selectedEnv && targetDb && targetTable) {
      fetchColumns(selectedEnv, targetDb, targetTable).then((cols) => {
        setTargetColumns(cols);
        setSelectedColumns(cols.map((c) => c.name));
      }).catch(() => setTargetColumns([]));
    }
  }, [open, selectedEnv, targetDb, targetTable]);

  // ── Reset ───────────────────────────────────────────────────────

  const resetAll = () => {
    setStep(0);
    setSourceType('s3');
    setS3Path(''); setS3AccessKey(''); setS3SecretKey(''); setS3Region(''); setS3Endpoint('');
    setGcsPath('');
    setHdfsPath(''); setHdfsUser('');
    setSourceDb(''); setSourceTable(''); setSourceWhere(''); setSourceTables([]);
    setUploadFile(null); setUploadProgress('idle'); setUploadPercent(0); setSubmitError(null);
    setTargetDb(initialDb || ''); setTargetTable(''); setTargetTables([]); setTargetColumns([]); setSelectedColumns([]);
    setFileFormat('csv'); setCsvDelimiter(','); setCsvSkipHeader(0); setCsvEnclose('"'); setCsvEscape('\\'); setJsonPaths(''); setJsonRoot('');
    setLoadLabel(''); setTimeout(3600); setMaxFilterRatio(0); setTimezone(''); setStrictMode(false);
    setLoadMode(initialMode || 'once'); setScheduleEvery(1); setScheduleUnit('DAY'); setScheduleStart(''); setTaskName('');
    setPipeName(''); setAutoIngest(true); setPollInterval(300);
    setPreviewLoading(false); setPreviewError(null); setPreviewResult(null);
    setCreateTableEnabled(false); setCreateTableSql(''); setInferLoading(false); setInferError(null); setShowQuery(false);
    setTableModel('duplicate'); setKeyCols([]); setInferredCols([]);
    setSubmitting(false);
  };

  useEffect(() => {
    if (open) resetAll();
  }, [open]);

  // Keep load mode valid for the chosen source (pipe = file sources only; upload = one-time only)
  useEffect(() => {
    if (loadMode === 'pipe' && (sourceType === 'table' || sourceType === 'upload')) setLoadMode('once');
    if (loadMode === 'task' && sourceType === 'upload') setLoadMode('once');
  }, [sourceType, loadMode]);

  // ── Auto-generate label ─────────────────────────────────────────

  const autoLabel = useMemo(() => {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tbl = targetTable || 'load';
    return `${tbl}_${ts}`;
  }, [targetTable]);

  const effectiveLabel = loadLabel || autoLabel;

  const autoTaskName = useMemo(() => {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tbl = targetTable || 'load';
    return `task_${tbl}_${ts}`;
  }, [targetTable]);

  const effectiveTaskName = taskName || autoTaskName;

  const autoPipeName = useMemo(() => {
    const tbl = targetTable || 'load';
    return `pipe_${tbl}`;
  }, [targetTable]);

  const effectivePipeName = pipeName || autoPipeName;

  // ── Preview & schema inference (file sources) ───────────────────

  const isFileSource = sourceType === 's3' || sourceType === 'gcs' || sourceType === 'hdfs';
  const rawFilePath = sourceType === 's3' ? s3Path : sourceType === 'gcs' ? gcsPath : hdfsPath;
  const tableExists = targetTables.includes(targetTable);

  // The Preview & Schema step only applies to file sources (it relies on FILES()).
  const stepKeys: StepKey[] = isFileSource
    ? ['source', 'target', 'preview', 'options', 'review']
    : ['source', 'target', 'options', 'review'];
  const steps = stepKeys.map((k) => STEP_META[k]);
  const currentKey: StepKey = stepKeys[step] ?? 'source';
  const lastStep = stepKeys.length - 1;

  // Keep the step index valid if the source change shrank the step list.
  useEffect(() => {
    if (step > stepKeys.length - 1) setStep(stepKeys.length - 1);
  }, [stepKeys.length, step]);

  // Build the FILES(...) clause shared by the load SQL, the data preview, and DESC.
  // `mask` redacts secret values for on-screen display (debugging) without hiding shape.
  const buildFilesClause = useCallback((rawPath: string, mask = false) => {
    const filesPath = rawPath
      .replace(/%7B/gi, '{').replace(/%7D/gi, '}')
      .replace(/\{[^}]*\}/g, '*');
    const params: string[] = [`"path" = "${filesPath}"`, `"format" = "${fileFormat}"`];
    if (fileFormat === 'csv') {
      if (csvDelimiter !== ',') params.push(`"csv.column_separator" = "${csvDelimiter}"`);
      if (csvSkipHeader > 0) params.push(`"csv.skip_header" = "${csvSkipHeader}"`);
      if (csvEnclose) params.push(`"csv.enclose" = "${csvEnclose}"`);
      if (csvEscape) params.push(`"csv.escape" = "${csvEscape}"`);
    }
    if (sourceType === 's3') {
      if (s3AccessKey) params.push(`"aws.s3.access_key" = "${s3AccessKey}"`);
      if (s3SecretKey) params.push(`"aws.s3.secret_key" = "${mask ? `<masked, ${s3SecretKey.length} chars>` : s3SecretKey}"`);
      if (s3Region) params.push(`"aws.s3.region" = "${s3Region}"`);
      if (s3Endpoint) params.push(`"aws.s3.endpoint" = "${s3Endpoint}"`);
    }
    // GCS: no per-query credentials — the cluster authenticates via core-site.xml
    // (fs.gs.auth.* + service-account JSON keyfile). Only the gs:// path is needed.
    return `FILES(\n    ${params.join(',\n    ')}\n  )`;
  }, [sourceType, fileFormat, csvDelimiter, csvSkipHeader, csvEnclose, csvEscape,
    s3AccessKey, s3SecretKey, s3Region, s3Endpoint]);

  // Default the create-table toggle on when the chosen target table doesn't exist yet.
  useEffect(() => {
    if (!isFileSource) { setCreateTableEnabled(false); return; }
    if (targetTable) setCreateTableEnabled(!targetTables.includes(targetTable));
  }, [targetTable, targetTables, isFileSource]);

  const handlePreview = async () => {
    if (!selectedEnv || !rawFilePath) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await runQuery(selectedEnv, `SELECT * FROM ${buildFilesClause(rawFilePath)} LIMIT 50`);
      setPreviewResult({ columns: res.columns || [], rows: res.rows || [] });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewResult(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Builds CREATE TABLE from inferred columns. Duplicate Key keeps every row; Primary
  // Key makes the key unique and upserts on reload (dedup). Key columns are moved to
  // the front (StarRocks requires keys to be the leading columns) and, for PK, NOT NULL.
  const buildCreateDDL = useCallback(
    (cols: { name: string; type: string; nullable: boolean }[], model: 'duplicate' | 'primary', keys: string[]) => {
      const bt = (s: string) => '`' + s + '`';
      const keySet = new Set(keys);
      const ordered = [
        ...keys.map((k) => cols.find((c) => c.name === k)).filter(Boolean) as typeof cols,
        ...cols.filter((c) => !keySet.has(c.name)),
      ];
      const repl = environments.find((e) => e.name === selectedEnv)?.default_replication_num || 3;
      const body = ordered.map((c, i) => {
        const notNull = (model === 'primary' && keySet.has(c.name)) || !c.nullable;
        return `  ${bt(c.name)} ${c.type}${notNull ? ' NOT NULL' : ' NULL'}${i < ordered.length - 1 ? ',' : ''}`;
      });
      const keyList = (keys.length ? keys : [ordered[0]?.name]).filter(Boolean).map(bt).join(', ');
      const keyClause = model === 'primary' ? `PRIMARY KEY(${keyList})` : `DUPLICATE KEY(${keyList})`;
      const distCol = keys[0] || ordered[0]?.name || '';
      return [
        `CREATE TABLE IF NOT EXISTS ${bt(targetDb)}.${bt(targetTable)} (`,
        ...body,
        `)`,
        keyClause,
        `DISTRIBUTED BY HASH(${bt(distCol)}) BUCKETS 10`,
        `PROPERTIES ("replication_num" = "${repl}");`,
      ].join('\n');
    },
    [environments, selectedEnv, targetDb, targetTable],
  );

  const handleInferSchema = async () => {
    if (!selectedEnv || !rawFilePath || !targetDb || !targetTable) {
      setInferError('Select a target database and table first.');
      return;
    }
    setInferLoading(true);
    setInferError(null);
    try {
      const res = await runQuery(selectedEnv, `DESC ${buildFilesClause(rawFilePath)}`);
      const cols = (res.rows || []).map((r) => ({
        name: String(r.Field ?? r.field ?? r.Name ?? r.name ?? ''),
        type: String(r.Type ?? r.type ?? 'string'),
        nullable: String(r.Null ?? r.null ?? 'YES').toUpperCase() !== 'NO',
      })).filter((c) => c.name);
      if (!cols.length) { setInferError('Could not infer any columns from the files.'); return; }
      setInferredCols(cols);
      const valid = keyCols.filter((k) => cols.some((c) => c.name === k));
      const kc = valid.length ? valid : [cols[0].name];
      setKeyCols(kc);
      setCreateTableSql(buildCreateDDL(cols, tableModel, kc));
    } catch (err) {
      setInferError(err instanceof Error ? err.message : String(err));
    } finally {
      setInferLoading(false);
    }
  };

  // ── SQL Generation ──────────────────────────────────────────────

  const generatedSQL = useMemo(() => {
    if (sourceType === 'upload') {
      // No SQL for stream load — show a description instead
      const lines: string[] = [];
      lines.push(`-- HTTP Stream Load`);
      lines.push(`-- File: ${uploadFile?.name || '(no file selected)'}`);
      lines.push(`-- Target: ${targetDb}.${targetTable}`);
      lines.push(`-- Format: ${fileFormat.toUpperCase()}`);
      if (fileFormat === 'csv' && csvDelimiter !== ',') lines.push(`-- Delimiter: "${csvDelimiter}"`);
      if (selectedColumns.length > 0 && selectedColumns.length < targetColumns.length) {
        lines.push(`-- Columns: ${selectedColumns.join(', ')}`);
      }
      if (loadLabel) lines.push(`-- Label: ${loadLabel}`);
      return lines.join('\n');
    }

    // Shared INSERT builders — used by one-time INSERT, scheduled task, and pipe.
    // Tasks/pipes can't wrap a Broker Load (LOAD LABEL), so file sources use the
    // FILES() table function; table-to-table reuses the plain INSERT ... SELECT.
    const subset = selectedColumns.length > 0 && selectedColumns.length < targetColumns.length;

    const buildTableInsert = () => {
      const cols = subset ? `\n  ${selectedColumns.join(',\n  ')}\n` : ' *\n';
      let sql = `INSERT INTO \`${targetDb}\`.\`${targetTable}\`\nSELECT${cols}FROM \`${sourceDb}\`.\`${sourceTable}\``;
      if (sourceWhere.trim()) sql += `\nWHERE ${sourceWhere.trim()}`;
      return sql;
    };

    // FILES() maps columns BY POSITION, so a `SELECT *` requires the file's column
    // order to match the table — which breaks when the key column is moved to the
    // front. Listing the target columns by name on BOTH sides makes it name-based
    // and order-independent (requires file column names to match the table's).
    const q = (c: string) => '`' + c + '`';
    const buildFilesInsert = (rawPath: string) => {
      if (selectedColumns.length > 0) {
        const cols = selectedColumns.map(q).join(', ');
        return `INSERT INTO \`${targetDb}\`.\`${targetTable}\` (${cols})\nSELECT ${cols} FROM ${buildFilesClause(rawPath)}`;
      }
      return `INSERT INTO \`${targetDb}\`.\`${targetTable}\`\nSELECT * FROM ${buildFilesClause(rawPath)}`;
    };

    // ── Scheduled task: SUBMIT TASK wrapping an INSERT ─────────────────────────
    if (loadMode === 'task') {
      const inner = sourceType === 'table' ? buildTableInsert() : buildFilesInsert(rawFilePath);
      const startClause = scheduleStart ? `START("${scheduleStart}") ` : '';
      return [
        `SUBMIT TASK \`${effectiveTaskName}\``,
        `SCHEDULE ${startClause}EVERY(INTERVAL ${scheduleEvery} ${scheduleUnit})`,
        `AS`,
        inner,
      ].join('\n') + ';';
    }

    // ── Continuous pipe: CREATE PIPE wrapping a FILES() INSERT ─────────────────
    if (loadMode === 'pipe') {
      const props: string[] = [`"AUTO_INGEST" = "${autoIngest ? 'TRUE' : 'FALSE'}"`];
      if (pollInterval && pollInterval !== 300) props.push(`"POLL_INTERVAL" = "${pollInterval}"`);
      return [
        `CREATE PIPE \`${targetDb}\`.\`${effectivePipeName}\``,
        `PROPERTIES (${props.join(', ')})`,
        `AS`,
        buildFilesInsert(rawFilePath),
      ].join('\n') + ';';
    }

    if (sourceType === 'table') {
      return buildTableInsert() + ';';
    }

    // Broker Load (S3 / GCS / HDFS)
    const lines: string[] = [];
    const filePath = sourceType === 's3' ? s3Path : sourceType === 'gcs' ? gcsPath : hdfsPath;

    lines.push(`LOAD LABEL \`${targetDb}\`.\`${effectiveLabel}\` (`);
    lines.push(`  DATA INFILE("${filePath}")`);
    lines.push(`  INTO TABLE \`${targetTable}\``);

    // Format
    if (fileFormat === 'csv') {
      if (csvDelimiter !== ',') {
        lines.push(`  COLUMNS TERMINATED BY "${csvDelimiter}"`);
      }
      if (csvSkipHeader > 0) {
        lines.push(`  SKIP_HEADER ${csvSkipHeader}`);
      }
      lines.push(`  FORMAT AS "csv"`);
    } else {
      lines.push(`  FORMAT AS "${fileFormat}"`);
    }

    // Column list
    if (selectedColumns.length > 0 && selectedColumns.length < targetColumns.length) {
      lines.push(`  (${selectedColumns.join(', ')})`);
    }

    lines.push(')');

    // JSON options
    if (fileFormat === 'json') {
      if (jsonRoot) lines.push(`JSONROOT "${jsonRoot}"`);
      if (jsonPaths) lines.push(`JSONPATHS '${jsonPaths}'`);
    }

    // GCS needs no inline credentials — the cluster authenticates via core-site.xml.
    const brokerProps: string[] = [];

    if (brokerProps.length > 0) {
      lines.push('WITH BROKER (');
      lines.push('  ' + brokerProps.join(',\n  '));
      lines.push(')');
    } else {
      lines.push('WITH BROKER');
    }

    // Properties
    const props: string[] = [];
    props.push(`"timeout" = "${timeout}"`);
    if (maxFilterRatio > 0) props.push(`"max_filter_ratio" = "${maxFilterRatio}"`);
    if (strictMode) props.push(`"strict_mode" = "true"`);
    if (timezone) props.push(`"timezone" = "${timezone}"`);

    // S3 credentials
    if (sourceType === 's3') {
      if (s3AccessKey) props.push(`"aws.s3.access_key" = "${s3AccessKey}"`);
      if (s3SecretKey) props.push(`"aws.s3.secret_key" = "${s3SecretKey}"`);
      if (s3Region) props.push(`"aws.s3.region" = "${s3Region}"`);
      if (s3Endpoint) props.push(`"aws.s3.endpoint" = "${s3Endpoint}"`);
    }

    // HDFS user
    if (sourceType === 'hdfs' && hdfsUser) {
      props.push(`"username" = "${hdfsUser}"`);
      props.push(`"hadoop.security.authentication" = "simple"`);
    }

    if (props.length > 0) {
      lines.push('PROPERTIES (');
      lines.push('  ' + props.join(',\n  '));
      lines.push(')');
    }

    return lines.join('\n') + ';';
  }, [
    sourceType, s3Path, s3AccessKey, s3SecretKey, s3Region, s3Endpoint,
    gcsPath,
    hdfsPath, hdfsUser,
    sourceDb, sourceTable, sourceWhere,
    targetDb, targetTable, selectedColumns, targetColumns,
    fileFormat, csvDelimiter, csvSkipHeader, csvEnclose, csvEscape, jsonPaths, jsonRoot,
    effectiveLabel, timeout, maxFilterRatio, strictMode, timezone,
    uploadFile, loadLabel,
    loadMode, scheduleEvery, scheduleUnit, scheduleStart, effectiveTaskName,
    autoIngest, pollInterval, effectivePipeName,
    buildFilesClause, rawFilePath,
  ]);

  // ── Validation ──────────────────────────────────────────────────

  const canNext = (key: StepKey): boolean => {
    switch (key) {
      case 'source':
        if (sourceType === 's3') return !!s3Path;
        if (sourceType === 'gcs') return !!gcsPath;
        if (sourceType === 'hdfs') return !!hdfsPath;
        if (sourceType === 'table') return !!sourceDb && !!sourceTable;
        if (sourceType === 'upload') return !!uploadFile;
        return false;
      case 'target': return !!targetDb && !!targetTable;
      case 'preview': return !createTableEnabled || !!createTableSql.trim();
      case 'options': return true;
      case 'review': return true;
      default: return true;
    }
  };

  // ── Submit ──────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selectedEnv) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Create the target table first if requested (file sources only).
      if (isFileSource && createTableEnabled && createTableSql.trim()) {
        await createTable(selectedEnv, createTableSql.trim());
      }
      if (sourceType === 'upload') {
        if (!uploadFile) throw new Error('No file selected');
        setUploadProgress('uploading');
        setUploadPercent(0);
        const opts: Record<string, string> = {};
        if (fileFormat === 'csv') {
          opts.format = 'csv';
          opts.column_separator = csvDelimiter;
          if (csvEnclose) opts.enclose = csvEnclose;
          if (csvEnclose) opts.escape = csvEscape;
          if (csvSkipHeader > 0) opts.skip_header = String(csvSkipHeader);
        } else if (fileFormat === 'json') {
          opts.format = 'json';
          if (jsonRoot) opts.json_root = jsonRoot;
          if (jsonPaths) opts.jsonpaths = jsonPaths;
        } else {
          opts.format = fileFormat;
        }
        if (selectedColumns.length > 0 && selectedColumns.length < targetColumns.length) {
          opts.columns = selectedColumns.join(',');
        }
        if (loadLabel) opts.label = loadLabel;
        if (maxFilterRatio > 0) opts.max_filter_ratio = String(maxFilterRatio);
        if (strictMode) opts.strict_mode = 'true';
        if (timezone) opts.timezone = timezone;

        const result = await streamLoad(selectedEnv, targetDb, targetTable, uploadFile, opts, (pct) => {
          setUploadPercent(pct);
        });
        const status = String(result.Status || result.status || '').toUpperCase();
        if (status === 'FAIL' || status === 'FAILED') {
          // Extract the most useful error from StarRocks response
          const errMsg = String(
            result.Message || result.ErrorMsg || result.msg || result.message || ''
          );
          const errUrl = result.ErrorURL ? `\nTracking URL: ${result.ErrorURL}` : '';
          const rejected = result.NumberFilteredRows
            ? `\nRejected rows: ${result.NumberFilteredRows}`
            : '';
          throw new Error(errMsg + rejected + errUrl || 'Stream load failed — check StarRocks FE logs');
        }
        setUploadProgress('done');
        const loaded = result.NumberLoadedRows || result.NumberTotalRows || '';
        message.success(`File uploaded successfully${loaded ? ` (${loaded} rows loaded)` : ''}`);
      } else if (loadMode === 'task') {
        await createScheduledTask(selectedEnv, generatedSQL, targetDb);
        message.success('Scheduled task created successfully');
      } else if (loadMode === 'pipe') {
        await createPipe(selectedEnv, generatedSQL, targetDb);
        message.success('Pipe created successfully');
      } else {
        await executeBatchLoad(selectedEnv, generatedSQL, targetDb);
        message.success('Load job submitted successfully');
      }
      resetAll();
      onSuccess();
    } catch (err) {
      setUploadProgress('error');
      const errText = err instanceof Error ? err.message : String(err);
      setSubmitError(errText);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Source type cards ───────────────────────────────────────────

  const sourceCards = [
    {
      key: 's3' as SourceType,
      title: 'Amazon S3 / MinIO',
      desc: 'Load from S3-compatible object storage',
      icon: '🪣',
    },
    {
      key: 'gcs' as SourceType,
      title: 'Google Cloud Storage',
      desc: 'Load from a gs:// path (cluster handles auth)',
      icon: '☁️',
    },
    {
      key: 'hdfs' as SourceType,
      title: 'HDFS',
      desc: 'Load from Hadoop Distributed File System',
      icon: '🐘',
    },
    {
      key: 'table' as SourceType,
      title: 'Table to Table',
      desc: 'INSERT INTO ... SELECT from another table',
      icon: '🔄',
    },
    {
      key: 'upload' as SourceType,
      title: 'File Upload',
      desc: 'Upload a local file via HTTP Stream Load',
      icon: '📤',
    },
  ];

  // ── Render Steps ────────────────────────────────────────────────

  const renderStep = () => {
    switch (currentKey) {
      case 'source': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Source type selector */}
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
              Data Source
            </Typography.Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {sourceCards.map((src) => {
                const selected = sourceType === src.key;
                return (
                  <Card
                    key={src.key}
                    hoverable
                    size="small"
                    onClick={() => setSourceType(src.key)}
                    style={{
                      borderColor: selected ? '#6366f1' : 'var(--sr-border)',
                      borderWidth: selected ? 2 : 1,
                      background: selected ? '#f5f3ff' : '#fff',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    styles={{ body: { padding: 12 } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                        background: selected ? '#ede9fe' : 'var(--sr-border-subtle)',
                      }}>
                        {src.icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: selected ? '#4f46e5' : 'var(--sr-text)', lineHeight: '18px' }}>
                          {src.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--sr-text-secondary)', marginTop: 2, lineHeight: '16px' }}>
                          {src.desc}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          <Divider style={{ margin: '4px 0' }} />

          {/* Source-specific fields */}
          {sourceType === 's3' && (
            <Form layout="vertical" size="small">
              <Form.Item
                label="S3 File Path"
                required
                tooltip="Full S3 URI. Supports wildcards: s3://bucket/path/*.csv"
              >
                <Input
                  value={s3Path}
                  onChange={(e) => setS3Path(e.target.value)}
                  placeholder="s3://my-bucket/data/2025/*.csv"
                  prefix={<FileTextOutlined style={{ color: 'var(--sr-text-muted)' }} />}
                />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Access Key">
                    <Input value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} placeholder="AKIA..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Secret Key">
                    <Input.Password value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} placeholder="Secret key" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Region">
                    <Input value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Custom Endpoint" tooltip="For MinIO or S3-compatible services">
                    <Input value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} placeholder="https://minio.internal:9000" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          )}

          {sourceType === 'gcs' && (
            <Form layout="vertical" size="small">
              <Form.Item
                label="GCS File Path"
                required
                tooltip="Full GCS URI. Use wildcards (*) to match multiple files: gs://bucket/path/*.parquet"
              >
                <Input
                  value={gcsPath}
                  onChange={(e) => setGcsPath(e.target.value)}
                  placeholder="gs://my-bucket/data/2025/*.parquet"
                  prefix={<FileTextOutlined style={{ color: 'var(--sr-text-muted)' }} />}
                />
              </Form.Item>
              <Alert
                type="info"
                showIcon
                message="No credentials needed"
                description="The StarRocks cluster authenticates to GCS itself (service-account keyfile in core-site.xml). Just provide the gs:// path."
                style={{ borderRadius: 8 }}
              />
            </Form>
          )}

          {sourceType === 'hdfs' && (
            <Form layout="vertical" size="small">
              <Form.Item
                label="HDFS File Path"
                required
                tooltip="Full HDFS URI. Supports wildcards."
              >
                <Input
                  value={hdfsPath}
                  onChange={(e) => setHdfsPath(e.target.value)}
                  placeholder="hdfs://namenode:8020/data/events/*.parquet"
                  prefix={<FileTextOutlined style={{ color: 'var(--sr-text-muted)' }} />}
                />
              </Form.Item>
              <Form.Item label="HDFS Username">
                <Input value={hdfsUser} onChange={(e) => setHdfsUser(e.target.value)} placeholder="hadoop" />
              </Form.Item>
            </Form>
          )}

          {sourceType === 'table' && (
            <Form layout="vertical" size="small">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Source Database" required>
                    <Select
                      value={sourceDb || undefined}
                      onChange={setSourceDb}
                      placeholder="Select database"
                      showSearch
                      filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                      options={databases.filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys').map((db) => ({ value: db, label: db }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="Source Table" required>
                    <Select
                      value={sourceTable || undefined}
                      onChange={setSourceTable}
                      placeholder="Select table"
                      showSearch
                      disabled={!sourceDb}
                      filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                      options={sourceTables.map((t) => ({ value: t, label: t }))}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="WHERE Clause" tooltip="Optional filter condition for source data">
                <Input value={sourceWhere} onChange={(e) => setSourceWhere(e.target.value)} placeholder="date >= '2025-01-01'" />
              </Form.Item>
            </Form>
          )}

          {sourceType === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Upload.Dragger
                accept=".csv,.tsv,.json,.jsonl,.parquet,.orc,.txt"
                maxCount={1}
                beforeUpload={(file) => {
                  setUploadFile(file);
                  return false; // prevent auto-upload
                }}
                onRemove={() => setUploadFile(null)}
                fileList={uploadFile ? [{ uid: '-1', name: uploadFile.name, status: 'done', size: uploadFile.size }] : []}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ color: '#6366f1', fontSize: 40 }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: 14 }}>
                  Click or drag file to this area
                </p>
                <p className="ant-upload-hint" style={{ fontSize: 12, color: 'var(--sr-text-muted)' }}>
                  Supports CSV, TSV, JSON, Parquet, ORC files. Max 512 MB.
                </p>
              </Upload.Dragger>
              {uploadFile && (
                <div style={{ fontSize: 12, color: 'var(--sr-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircleOutlined style={{ color: '#22c55e' }} />
                  {uploadFile.name} ({(uploadFile.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
              )}
              <Alert
                type="info"
                showIcon
                message="HTTP Stream Load"
                description="The file will be uploaded directly to StarRocks via HTTP Stream Load API. This is best for files under 512 MB. For larger datasets, use S3 or HDFS Broker Load."
                style={{ borderRadius: 8 }}
              />
            </div>
          )}
        </div>
      );

      case 'target': return (
        <Form layout="vertical" size="small">
          <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
            <DatabaseOutlined style={{ marginRight: 6 }} />
            Target Table
          </Typography.Text>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Database" required>
                <Select
                  value={targetDb || undefined}
                  onChange={(v) => { setTargetDb(v); setTargetTable(''); }}
                  placeholder="Select database"
                  showSearch
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                  options={databases.filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys').map((db) => ({ value: db, label: db }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Table" required tooltip={isFileSource ? 'Pick an existing table, or type a new name — you can create it in the next step.' : undefined}>
                <Space.Compact style={{ width: '100%' }}>
                  <AutoComplete
                    value={targetTable || undefined}
                    onChange={(v) => setTargetTable(v || '')}
                    placeholder={isFileSource ? 'Select or type a new table' : 'Select table'}
                    disabled={!targetDb}
                    filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                    options={targetTables.map((t) => ({ value: t, label: t }))}
                    style={{ flex: 1 }}
                  />
                  <Tooltip title="Create new table (full wizard)">
                    <Button
                      icon={<PlusOutlined />}
                      disabled={!targetDb}
                      onClick={() => setCreateTableOpen(true)}
                    />
                  </Tooltip>
                </Space.Compact>
              </Form.Item>
            </Col>
          </Row>

          {/* Column selector */}
          {targetColumns.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Typography.Text strong style={{ fontSize: 13 }}>
                  Columns ({selectedColumns.length} / {targetColumns.length})
                </Typography.Text>
                <Button
                  type="link"
                  size="small"
                  onClick={() =>
                    setSelectedColumns(
                      selectedColumns.length === targetColumns.length ? [] : targetColumns.map((c) => c.name)
                    )
                  }
                >
                  {selectedColumns.length === targetColumns.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6,
                maxHeight: 160, overflow: 'auto', padding: 4,
              }}>
                {targetColumns.map((col) => {
                  const selected = selectedColumns.includes(col.name);
                  return (
                    <Tooltip key={col.name} title={`${col.type}${col.nullable === 'YES' ? ' (nullable)' : ''}`}>
                      <div
                        onClick={() =>
                          setSelectedColumns(
                            selected
                              ? selectedColumns.filter((c) => c !== col.name)
                              : [...selectedColumns, col.name]
                          )
                        }
                        style={{
                          padding: '3px 10px',
                          borderRadius: 6,
                          border: `1px solid ${selected ? '#6366f1' : 'var(--sr-border)'}`,
                          background: selected ? '#f5f3ff' : '#fff',
                          color: selected ? '#6366f1' : 'var(--sr-text-secondary)',
                          fontSize: 12,
                          cursor: 'pointer',
                          fontWeight: selected ? 500 : 400,
                          transition: 'all 0.15s',
                        }}
                      >
                        {col.name}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </>
          )}

          {/* File format — for S3/HDFS/Upload */}
          {sourceType !== 'table' && (
            <>
              <Divider style={{ margin: '16px 0 12px' }} />
              <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
                <FileTextOutlined style={{ marginRight: 6 }} />
                File Format
              </Typography.Text>

              <Form.Item label="Format">
                <Radio.Group value={fileFormat} onChange={(e) => setFileFormat(e.target.value)}>
                  {FILE_FORMATS.map((f) => (
                    <Radio.Button key={f.value} value={f.value}>{f.label}</Radio.Button>
                  ))}
                </Radio.Group>
              </Form.Item>

              {fileFormat === 'csv' && (
                <>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item label="Column Delimiter">
                        <Select
                          value={csvDelimiter}
                          onChange={setCsvDelimiter}
                          options={[
                            { value: ',', label: 'Comma (,)' },
                            { value: '\\t', label: 'Tab (\\t)' },
                            { value: '|', label: 'Pipe (|)' },
                            { value: ';', label: 'Semicolon (;)' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="Enclose Character" tooltip="Character that wraps field values containing the delimiter (e.g. double-quote for standard CSV)">
                        <Select
                          value={csvEnclose}
                          onChange={setCsvEnclose}
                          options={[
                            { value: '"', label: 'Double-quote (")' },
                            { value: "'", label: "Single-quote (')" },
                            { value: '', label: 'None' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="Skip Header Rows">
                        <InputNumber value={csvSkipHeader} onChange={(v) => setCsvSkipHeader(v || 0)} min={0} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}

              {fileFormat === 'json' && (
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item label="JSON Root" tooltip="Root path in JSON document, e.g. $.data">
                      <Input value={jsonRoot} onChange={(e) => setJsonRoot(e.target.value)} placeholder="$.data" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="JSON Paths" tooltip='Column mapping, e.g. ["$.id","$.name"]'>
                      <Input value={jsonPaths} onChange={(e) => setJsonPaths(e.target.value)} placeholder='["$.id","$.name"]' />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </>
          )}
        </Form>
      );

      case 'preview': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Data preview */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                <EyeOutlined style={{ marginRight: 6 }} />
                Data preview
              </Typography.Text>
              <Button size="small" icon={<EyeOutlined />} loading={previewLoading} onClick={handlePreview} disabled={!rawFilePath}>
                Preview ~50 rows
              </Button>
            </div>
            {previewError && (
              <Alert type="error" showIcon closable onClose={() => setPreviewError(null)} message="Preview failed"
                description={
                  <>
                    {previewError}
                    {previewError.includes('metadata.google') && (
                      <div style={{ marginTop: 6 }}>
                        <b>Tip:</b> The cluster fell back to VM credentials — its GCS service-account keyfile (core-site.xml: <code>fs.gs.auth.*</code>) isn't configured on this environment's FE/BE nodes.
                      </div>
                    )}
                  </>
                }
                style={{ marginBottom: 8, borderRadius: 8 }} />
            )}
            {rawFilePath && (
              <div style={{ marginBottom: 8 }}>
                <Space size={12}>
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setShowQuery((s) => !s)}>
                    {showQuery ? 'Hide' : 'Show'} generated query
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(`SELECT * FROM ${buildFilesClause(rawFilePath)} LIMIT 50`);
                      message.success('Query copied (with real credentials) — paste into the Query console to debug');
                    }}
                  >
                    Copy query
                  </Button>
                </Space>
                {showQuery && (
                  <pre style={{
                    background: 'var(--sr-code-bg)', color: 'var(--sr-code-fg)', borderRadius: 8, padding: 12,
                    fontSize: 11, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    maxHeight: 220, overflow: 'auto', marginTop: 6,
                  }}>
                    {`SELECT * FROM ${buildFilesClause(rawFilePath, true)} LIMIT 50`}
                  </pre>
                )}
              </div>
            )}
            {previewResult ? (
              <>
                <Table
                  className="sr-table"
                  size="small"
                  columns={previewResult.columns.map((c) => ({
                    title: c,
                    dataIndex: c,
                    key: c,
                    ellipsis: true,
                    render: (v: unknown) => v === null || v === undefined
                      ? <span style={{ color: 'var(--sr-text-faint)' }}>NULL</span>
                      : <span style={{ fontSize: 12 }}>{String(v)}</span>,
                  }))}
                  dataSource={previewResult.rows.map((r, i) => ({ ...r, _k: i }))}
                  rowKey="_k"
                  pagination={{ pageSize: 10, size: 'small' }}
                  scroll={{ x: 'max-content', y: 240 }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Showing {previewResult.rows.length} sampled row{previewResult.rows.length !== 1 ? 's' : ''} (best effort — fewer if the source has fewer).
                </Typography.Text>
              </>
            ) : !previewError && (
              <div className="sr-empty-state" style={{ padding: '24px' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Click “Preview ~50 rows” to sample the source files via FILES().
                </Typography.Text>
              </div>
            )}
          </div>

          <Divider style={{ margin: '4px 0' }} />

          {/* Create target table */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Space size={8}>
                <Typography.Text strong style={{ fontSize: 13 }}>Create target table</Typography.Text>
                <Tooltip title="When on, the table is created (CREATE TABLE IF NOT EXISTS) before the load runs. Schema is inferred from the files — edit types/keys below.">
                  <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                </Tooltip>
                {targetTable && (tableExists
                  ? <Tag color="green" style={{ borderRadius: 4 }}>table exists</Tag>
                  : <Tag color="orange" style={{ borderRadius: 4 }}>not found</Tag>)}
              </Space>
              <Switch checked={createTableEnabled} onChange={setCreateTableEnabled} />
            </div>

            {createTableEnabled && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <Button size="small" icon={<ReloadOutlined />} loading={inferLoading} onClick={handleInferSchema} disabled={!rawFilePath || !targetTable}>
                    Infer schema from files
                  </Button>
                </div>
                {inferError && (
                  <Alert type="error" showIcon closable onClose={() => setInferError(null)} message="Schema inference failed"
                    description={
                      <>
                        {inferError}
                        {inferError.includes('metadata.google') && (
                          <div style={{ marginTop: 6 }}>
                            <b>Tip:</b> The cluster's GCS keyfile (core-site.xml <code>fs.gs.auth.*</code>) isn't configured on this environment's FE/BE nodes.
                          </div>
                        )}
                        {inferError.includes('1064') && inferError.toLowerCase().includes('desc') && (
                          <div style={{ marginTop: 6 }}>
                            <b>Tip:</b> <code>DESC FILES</code> needs StarRocks 3.3.4+. On older versions, type the CREATE TABLE manually in the editor below.
                          </div>
                        )}
                      </>
                    }
                    style={{ marginBottom: 8, borderRadius: 8 }} />
                )}
                {inferredCols.length > 0 && (
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <Space size={6}>
                      <Typography.Text style={{ fontSize: 12 }}>Model:</Typography.Text>
                      <Radio.Group
                        size="small"
                        value={tableModel}
                        onChange={(e) => { const m = e.target.value; setTableModel(m); setCreateTableSql(buildCreateDDL(inferredCols, m, keyCols)); }}
                      >
                        <Radio.Button value="duplicate">Duplicate</Radio.Button>
                        <Radio.Button value="primary">Primary Key</Radio.Button>
                      </Radio.Group>
                      <Tooltip title="Duplicate Key keeps every row (no dedup) — the key is only a sort index. Primary Key makes the key unique and upserts on reload (dedup); key columns become NOT NULL and lead the table.">
                        <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
                      </Tooltip>
                    </Space>
                    <Space size={6} style={{ flex: 1, minWidth: 240 }}>
                      <Typography.Text style={{ fontSize: 12 }}>Key:</Typography.Text>
                      <Select
                        mode="multiple"
                        size="small"
                        value={keyCols}
                        onChange={(keys) => { setKeyCols(keys); setCreateTableSql(buildCreateDDL(inferredCols, tableModel, keys)); }}
                        options={inferredCols.map((c) => ({ value: c.name, label: c.name }))}
                        placeholder="key column(s)"
                        maxTagCount={4}
                        style={{ flex: 1, minWidth: 220 }}
                      />
                    </Space>
                  </div>
                )}
                <div style={{ height: 240, borderRadius: 4, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                  <Editor
                    language="sql"
                    value={createTableSql}
                    onChange={(v) => setCreateTableSql(v || '')}
                    options={{ minimap: { enabled: false }, lineNumbers: 'on', fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true }}
                    theme={isDark ? 'vs-dark' : 'vs-light'}
                  />
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
                  Inferred via <code>DESC FILES</code> (StarRocks 3.3.4+). Pick the <b>model</b> (Primary Key dedups on reload; Duplicate keeps every row) and <b>key</b> columns above; <code>replication_num</code> is prefilled from this environment (must be ≤ its BE count). Edit anything in the SQL before running — it runs before the load.
                </Typography.Text>
              </div>
            )}
          </div>
        </div>
      );

      case 'options': return (
        <Form layout="vertical" size="small">
          <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
            <SettingOutlined style={{ marginRight: 6 }} />
            Load Options
          </Typography.Text>

          {/* Load mode — one-time vs StarRocks-native automation */}
          <div style={{ background: 'var(--sr-card-alt)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <Space style={{ marginBottom: 10 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>Mode</Typography.Text>
              <Tooltip title="One-time runs once now. Scheduled task reruns on an interval (SUBMIT TASK). Continuous creates a PIPE that auto-ingests new files as they land — ideal for date-partitioned buckets.">
                <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)' }} />
              </Tooltip>
            </Space>
            <div>
              <Radio.Group
                value={loadMode}
                onChange={(e) => setLoadMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="once">One-time</Radio.Button>
                <Radio.Button value="task" disabled={sourceType === 'upload'}>Scheduled task</Radio.Button>
                <Radio.Button value="pipe" disabled={sourceType === 'table' || sourceType === 'upload'}>Continuous (PIPE)</Radio.Button>
              </Radio.Group>
            </div>

            {loadMode === 'task' && (
              <div style={{ marginTop: 12 }}>
                <Form.Item label="Task Name" tooltip="Unique name for the scheduled task. Auto-generated if empty." style={{ marginBottom: 12 }}>
                  <Input value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder={autoTaskName} />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item label="Run every" style={{ marginBottom: 4 }}>
                      <InputNumber value={scheduleEvery} onChange={(v) => setScheduleEvery(v || 1)} min={1} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="Unit" style={{ marginBottom: 4 }}>
                      <Select
                        value={scheduleUnit}
                        onChange={(v) => setScheduleUnit(v as 'MINUTE' | 'HOUR' | 'DAY')}
                        options={[
                          { value: 'MINUTE', label: 'Minute(s)' },
                          { value: 'HOUR', label: 'Hour(s)' },
                          { value: 'DAY', label: 'Day(s)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label="Start (optional)" tooltip="First run time. Leave empty to start immediately." style={{ marginBottom: 4 }}>
                      <DatePicker
                        showTime
                        format="YYYY-MM-DD HH:mm:ss"
                        style={{ width: '100%' }}
                        onChange={(_, ds) => setScheduleStart(typeof ds === 'string' ? ds : '')}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Minimum interval is 10 seconds. The load runs as INSERT … SELECT FROM FILES().
                </Typography.Text>
              </div>
            )}

            {loadMode === 'pipe' && (
              <div style={{ marginTop: 12 }}>
                <Form.Item label="Pipe Name" tooltip="Unique name for the pipe. Auto-generated if empty." style={{ marginBottom: 12 }}>
                  <Input value={pipeName} onChange={(e) => setPipeName(e.target.value)} placeholder={autoPipeName} />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item label="Auto-ingest" tooltip="On = keep polling and load new files as they appear. Off = load only the files present now." style={{ marginBottom: 4 }}>
                      <Select
                        value={autoIngest ? 'true' : 'false'}
                        onChange={(v) => setAutoIngest(v === 'true')}
                        options={[
                          { value: 'true', label: 'On (continuous)' },
                          { value: 'false', label: 'Off (one-time)' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="Poll interval (sec)" tooltip="How often to scan for new files. Default 300." style={{ marginBottom: 4 }}>
                      <InputNumber value={pollInterval} onChange={(v) => setPollInterval(v || 300)} min={10} style={{ width: '100%' }} disabled={!autoIngest} />
                    </Form.Item>
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  Dynamic date folders like {'{YYYY-MM-DD}'} become a wildcard (*) — the pipe loads each new file exactly once (dedup by name + digest).
                </Typography.Text>
              </div>
            )}
          </div>

          {loadMode === 'once' && (
          <>
          {sourceType !== 'table' && (
            <Form.Item
              label="Load Label"
              tooltip="Unique label for this load job. Auto-generated if empty."
            >
              <Input
                value={loadLabel}
                onChange={(e) => setLoadLabel(e.target.value)}
                placeholder={autoLabel}
              />
            </Form.Item>
          )}

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item label="Timeout (seconds)" tooltip="Maximum time the load job can run">
                <InputNumber value={timeout} onChange={(v) => setTimeout(v || 3600)} min={60} max={86400} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Max Filter Ratio" tooltip="Maximum ratio of error rows allowed (0 = no errors allowed, 0.1 = 10% errors OK)">
                <InputNumber value={maxFilterRatio} onChange={(v) => setMaxFilterRatio(v || 0)} min={0} max={1} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Strict Mode" tooltip="When enabled, rejects rows that fail type conversion instead of using NULL">
                <Select
                  value={strictMode ? 'true' : 'false'}
                  onChange={(v) => setStrictMode(v === 'true')}
                  options={[
                    { value: 'false', label: 'Off' },
                    { value: 'true', label: 'On' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Timezone" tooltip="Timezone for date/time conversions. Leave empty for server default.">
            <Select
              value={timezone || undefined}
              onChange={(v) => setTimezone(v || '')}
              placeholder="Server default"
              allowClear
              onClear={() => setTimezone('')}
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
          </>
          )}

          {sourceType === 'upload' && (
            <Alert
              type="info"
              showIcon
              message="How HTTP Stream Load works"
              description="The file will be uploaded and loaded synchronously. You'll see the result immediately after upload completes. Best for files up to 512 MB."
              style={{ borderRadius: 8 }}
            />
          )}
          {(sourceType === 's3' || sourceType === 'gcs' || sourceType === 'hdfs') && loadMode === 'once' && (
            <Alert
              type="info"
              showIcon
              message="How Broker Load works"
              description="The load job runs asynchronously on the StarRocks cluster. After submission, you can monitor its progress in the Batch Load Jobs list. Large loads may take several minutes to complete."
              style={{ borderRadius: 8 }}
            />
          )}
          {loadMode === 'task' && (
            <Alert
              type="info"
              showIcon
              message="StarRocks scheduled task"
              description="A SUBMIT TASK is created and the StarRocks FE runs it on the interval — no external scheduler. View run history, trigger manually, or drop it from the Automation screen."
              style={{ borderRadius: 8 }}
            />
          )}
          {loadMode === 'pipe' && (
            <Alert
              type="info"
              showIcon
              message="StarRocks continuous pipe"
              description="A PIPE is created. With auto-ingest on, StarRocks keeps loading new files that match the path as they appear (dedup by file name + digest). Manage it — suspend, resume, view files, drop — from the Automation screen."
              style={{ borderRadius: 8 }}
            />
          )}
        </Form>
      );

      case 'review': return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Upload progress */}
          {sourceType === 'upload' && uploadProgress === 'uploading' && (
            <div style={{ background: 'var(--sr-card-alt)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <UploadOutlined style={{ color: '#6366f1' }} />
                <Typography.Text strong style={{ fontSize: 13 }}>
                  {uploadPercent < 100 ? 'Uploading file...' : 'Processing on StarRocks...'}
                </Typography.Text>
              </div>
              <Progress
                percent={uploadPercent}
                status={uploadPercent < 100 ? 'active' : 'normal'}
                strokeColor={{ from: '#6366f1', to: '#818cf8' }}
              />
              {uploadPercent >= 100 && (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  File uploaded. Waiting for StarRocks to process the data...
                </Typography.Text>
              )}
            </div>
          )}

          {/* Error display */}
          {submitError && (
            <Alert
              type="error"
              showIcon
              closable
              onClose={() => setSubmitError(null)}
              message="Load failed"
              description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>{submitError}</pre>}
              style={{ borderRadius: 8 }}
            />
          )}

          {/* SQL Preview */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: -4 }}>
            <CodeOutlined style={{ color: '#6366f1' }} />
            <Typography.Text strong style={{ fontSize: 13 }}>
              {sourceType === 'upload' ? 'Stream Load Summary' : 'Generated SQL'}
            </Typography.Text>
            <Tooltip title="Copy to clipboard">
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(generatedSQL);
                  message.success('Copied to clipboard');
                }}
              />
            </Tooltip>
          </div>

          <div
            style={{
              background: 'var(--sr-code-bg)',
              color: 'var(--sr-code-fg)',
              borderRadius: 8,
              padding: 16,
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: '20px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: 340,
              overflow: 'auto',
            }}
          >
            {generatedSQL}
          </div>

          {/* Summary */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '6px 16px',
              fontSize: 12,
              color: 'var(--sr-text-secondary)',
              background: 'var(--sr-card-alt)',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>Source:</span>
            <span>
              {sourceType === 's3' ? `S3: ${s3Path}` : sourceType === 'gcs' ? `GCS: ${gcsPath}` : sourceType === 'hdfs' ? `HDFS: ${hdfsPath}` : sourceType === 'upload' ? `File: ${uploadFile?.name || ''}` : `${sourceDb}.${sourceTable}`}
            </span>
            <span style={{ fontWeight: 600 }}>Target:</span>
            <span>{targetDb}.{targetTable}</span>
            {sourceType !== 'table' && (
              <>
                <span style={{ fontWeight: 600 }}>Format:</span>
                <span>{fileFormat.toUpperCase()}{fileFormat === 'csv' ? ` (delimiter: "${csvDelimiter}")` : ''}</span>
                {loadMode === 'once' && (
                  <>
                    <span style={{ fontWeight: 600 }}>Label:</span>
                    <span>{effectiveLabel}</span>
                  </>
                )}
              </>
            )}
            {loadMode === 'task' && (
              <>
                <span style={{ fontWeight: 600 }}>Task:</span>
                <span>{effectiveTaskName}</span>
                <span style={{ fontWeight: 600 }}>Schedule:</span>
                <span>every {scheduleEvery} {scheduleUnit.toLowerCase()}{scheduleEvery > 1 ? 's' : ''}{scheduleStart ? ` from ${scheduleStart}` : ''}</span>
              </>
            )}
            {loadMode === 'pipe' && (
              <>
                <span style={{ fontWeight: 600 }}>Pipe:</span>
                <span>{effectivePipeName}</span>
                <span style={{ fontWeight: 600 }}>Ingest:</span>
                <span>{autoIngest ? `continuous (poll ${pollInterval}s)` : 'one-time'}</span>
              </>
            )}
            <span style={{ fontWeight: 600 }}>Columns:</span>
            <span>{selectedColumns.length > 0 ? `${selectedColumns.length} selected` : 'All'}</span>
          </div>
        </div>
      );

      default: return null;
    }
  };

  return (
    <Modal
      title={
        <Space>
          <SwapOutlined style={{ color: '#6366f1' }} />
          <span>Batch Load</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={720}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={step === 0 ? onClose : () => setStep(step - 1)}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Space>
            {step < lastStep ? (
              <Button type="primary" onClick={() => setStep(step + 1)} disabled={!canNext(currentKey)}>
                Next
              </Button>
            ) : (
              <Button type="primary" loading={submitting} onClick={handleSubmit} icon={loadMode !== 'once' ? <ClockCircleOutlined /> : sourceType === 'upload' ? <UploadOutlined /> : undefined}>
                {loadMode === 'task' ? 'Create Scheduled Task' : loadMode === 'pipe' ? 'Create Pipe' : sourceType === 'upload' ? 'Upload & Load' : 'Execute Load'}
              </Button>
            )}
          </Space>
        </div>
      }
    >
      <Steps
        current={step}
        size="small"
        items={steps}
        style={{ marginBottom: 24 }}
        onChange={(s) => {
          // Allow clicking completed steps to go back
          if (s < step) setStep(s);
        }}
      />
      {renderStep()}

      {/* Create Table sub-wizard — renders above the Batch Load modal */}
      <CreateTableWizard
        open={createTableOpen}
        onClose={() => setCreateTableOpen(false)}
        onSuccess={() => {
          setCreateTableOpen(false);
          // Refresh target table list
          if (selectedEnv && targetDb) {
            fetchTables(selectedEnv, targetDb).then(setTargetTables).catch(() => {});
          }
        }}
        databases={databases.filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys')}
        initialDb={targetDb}
      />
    </Modal>
  );
}
