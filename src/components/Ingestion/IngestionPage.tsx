import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Select, Alert, Button, Space, Typography, Tooltip, Tabs } from 'antd';
import {
  PlusOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  TableOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  SwapOutlined,
  SyncOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { fetchDatabases, fetchTables, fetchRoutineLoadsForDB, fetchRoutines } from '../../api/client';
import { useEnvStore } from '../../store/envStore';
import { useAuthStore } from '../../store/authStore';
import RoutineLoadTable from '../shared/RoutineLoadTable';
import AutoRefresh from '../shared/AutoRefresh';
import CreateRoutineLoadWizard from './CreateRoutineLoadWizard';
import BatchLoadWizard from './BatchLoadWizard';
import BatchLoadList from './BatchLoadList';

export default function IngestionPage() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  const role = useAuthStore((s) => s.role);

  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routineWizardOpen, setRoutineWizardOpen] = useState(false);
  const [batchWizardOpen, setBatchWizardOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('routine');
  const [stateFilter, setStateFilter] = useState<string[]>([]);

  const isAllDbs = selectedDb === '__all__';

  // Load databases and auto-select the first one
  useEffect(() => {
    if (!selectedEnv) return;
    setDbLoading(true);
    setDatabases([]);
    setSelectedDb('__all__');
    setSelectedTable('');
    setTables([]);
    setData([]);
    fetchDatabases(selectedEnv)
      .then((dbs) => {
        setDatabases(dbs);
      })
      .catch(() => {})
      .finally(() => setDbLoading(false));
  }, [selectedEnv]);

  // Load tables when db changes (skip for "All Databases")
  useEffect(() => {
    if (!selectedEnv || !selectedDb || selectedDb === '__all__') {
      setTables([]);
      setSelectedTable('');
      return;
    }
    setTableLoading(true);
    setSelectedTable('');
    fetchTables(selectedEnv, selectedDb)
      .then(setTables)
      .catch(() => {})
      .finally(() => setTableLoading(false));
  }, [selectedEnv, selectedDb]);

  // Load routine loads when db or table changes. Only the latest request may
  // write state, so switching database mid-flight can't show the old one's jobs.
  const requestSeq = useRef(0);
  const loadData = useCallback(() => {
    const seq = ++requestSeq.current;
    if (!selectedEnv || !selectedDb) {
      setData([]);
      return;
    }
    setLoading(true);
    setError(null);
    const promise = selectedDb === '__all__'
      ? fetchRoutines(selectedEnv)
      : fetchRoutineLoadsForDB(selectedEnv, selectedDb, selectedTable || undefined);
    promise
      .then((rows) => { if (seq === requestSeq.current) setData(rows); })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err.message);
        setData([]);
      })
      .finally(() => { if (seq === requestSeq.current) setLoading(false); });
  }, [selectedEnv, selectedDb, selectedTable]);

  useEffect(() => {
    setData([]);
    loadData();
  }, [loadData]);

  const filtered = useMemo(
    () => (stateFilter.length > 0 ? data.filter((d) => stateFilter.includes(String(d.State || '').toUpperCase())) : data),
    [data, stateFilter],
  );

  if (!selectedEnv) {
    return (
      <Alert
        message="No Environment Selected"
        description="Select an environment from the top-right dropdown to manage ingestion jobs."
        type="info"
        showIcon
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            <CloudDownloadOutlined style={{ marginRight: 8 }} />
            Ingestion
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            Manage routine load and batch load jobs for your StarRocks databases.
          </Typography.Text>
        </div>
        {role === 'admin' && (
          <Space>
            <Button
              icon={<SwapOutlined />}
              onClick={() => setBatchWizardOpen(true)}
              style={{ borderRadius: 8 }}
            >
              Batch Load
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setRoutineWizardOpen(true)}
              style={{ borderRadius: 8 }}
            >
              Routine Load
            </Button>
          </Space>
        )}
      </div>

      {/* Filters */}
      <div className="sr-card" style={{ padding: 16 }}>
        <Space size={12} wrap>
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
              style={{ width: 240 }}
              allowClear
              onClear={() => setSelectedDb('')}
              options={[
                { value: '__all__', label: 'All Databases' },
                ...databases
                  .filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys')
                  .map((db) => ({ value: db, label: db })),
              ]}
            />
          </Space>

          <Space size={6}>
            <TableOutlined style={{ color: '#6366f1' }} />
            <Typography.Text strong style={{ fontSize: 13 }}>Table:</Typography.Text>
            <Select
              value={selectedTable || undefined}
              onChange={(v) => setSelectedTable(v)}
              placeholder={isAllDbs ? 'Select a database first' : selectedDb ? 'All tables' : 'Select database first'}
              loading={tableLoading}
              disabled={!selectedDb || isAllDbs}
              showSearch
              filterOption={(input, option) =>
                String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
              }
              style={{ width: 240 }}
              allowClear
              onClear={() => setSelectedTable('')}
              options={tables.map((t) => ({ value: t, label: t }))}
            />
            <Tooltip title="Filter jobs by target table. Leave empty to see all jobs in the database.">
              <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)', cursor: 'help' }} />
            </Tooltip>
          </Space>

          <Space size={6}>
            <FilterOutlined style={{ color: '#8b5cf6' }} />
            <Typography.Text strong style={{ fontSize: 13 }}>State:</Typography.Text>
            <Select
              mode="multiple"
              value={stateFilter}
              onChange={setStateFilter}
              placeholder="All states"
              style={{ minWidth: 200 }}
              allowClear
              maxTagCount={2}
              options={[
                { value: 'RUNNING', label: 'Running' },
                { value: 'PAUSED', label: 'Paused' },
                { value: 'NEED_SCHEDULE', label: 'Scheduling' },
                { value: 'LOADING', label: 'Loading' },
                { value: 'PREPARED', label: 'Prepared' },
                { value: 'COMMITTED', label: 'Committed' },
                { value: 'FINISHED', label: 'Finished' },
                { value: 'CANCELLED', label: 'Cancelled' },
                { value: 'STOPPED', label: 'Stopped' },
                { value: 'PENDING', label: 'Pending' },
              ]}
            />
          </Space>
        </Space>
      </div>

      {/* Error */}
      {error && (
        <Alert
          message="Failed to load routine load jobs"
          description={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(null)}
        />
      )}

      {/* Tabs: Routine Load + Batch Load */}
      {selectedDb ? (
        <div className="sr-card" style={{ padding: '12px 16px 16px' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'routine',
                label: (
                  <Space size={6}>
                    <SyncOutlined />
                    Routine Load
                  </Space>
                ),
                children: (
                  <div>
                    {/* Always mounted: an empty result must not drop the auto-refresh interval. */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {filtered.length} job{filtered.length !== 1 ? 's' : ''}
                        {isAllDbs ? '' : ` in "${selectedDb}"`}
                        {selectedTable ? ` (table: ${selectedTable})` : ''}
                      </Typography.Text>
                      <AutoRefresh onRefresh={loadData} loading={loading} />
                    </div>
                    {!loading && !error && filtered.length === 0 ? (
                      <div className="sr-empty-state" style={{ padding: '32px 24px' }}>
                        <InboxOutlined className="empty-icon" style={{ fontSize: 36 }} />
                        <div className="empty-title">No routine load jobs</div>
                        <div className="empty-desc">
                          {stateFilter.length > 0
                            ? 'No jobs matching the selected state filter.'
                            : isAllDbs
                              ? 'No routine load jobs found.'
                              : `No routine load jobs found in "${selectedDb}"${selectedTable ? ` for table "${selectedTable}"` : ''}.`
                          }
                        </div>
                      </div>
                    ) : (
                      <RoutineLoadTable
                        data={filtered}
                        loading={loading && data.length === 0}
                        onRefresh={loadData}
                        showDbColumn={isAllDbs}
                      />
                    )}
                  </div>
                ),
              },
              {
                key: 'batch',
                label: (
                  <Space size={6}>
                    <SwapOutlined />
                    Batch Load
                  </Space>
                ),
                children: <BatchLoadList database={selectedDb} stateFilter={stateFilter} />,
              },
            ]}
          />
        </div>
      ) : (
        <div className="sr-card" style={{ padding: 16 }}>
          <div className="sr-empty-state">
            <DatabaseOutlined className="empty-icon" />
            <div className="empty-title">Select a database</div>
            <div className="empty-desc">
              Choose a database from the dropdown above to view its ingestion jobs.
            </div>
          </div>
        </div>
      )}

      {/* Routine Load Wizard */}
      <CreateRoutineLoadWizard
        open={routineWizardOpen}
        onClose={() => setRoutineWizardOpen(false)}
        onSuccess={() => {
          setRoutineWizardOpen(false);
          loadData();
        }}
        databases={databases}
        initialDb={selectedDb}
      />

      {/* Batch Load Wizard */}
      <BatchLoadWizard
        open={batchWizardOpen}
        onClose={() => setBatchWizardOpen(false)}
        onSuccess={() => {
          setBatchWizardOpen(false);
          setActiveTab('batch');
        }}
        databases={databases}
        initialDb={selectedDb}
      />
    </div>
  );
}
