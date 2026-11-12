import { Button, Alert, Spin, Tooltip, Tag } from 'antd';
import {
  CaretRightOutlined,
  ClockCircleOutlined,
  TableOutlined,
  FilterOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import SqlEditor from './SqlEditor';
import ResultTable from './ResultTable';
import ExportBar from './ExportBar';
import ExplainButton from './ExplainButton';
import ExportFilesButton from './ExportFilesButton';
import QuerySettings from './QuerySettings';
import JsonGuide from './JsonGuide';
import QueryGuide from './QueryGuide';
import { useStreamingQuery } from '../../hooks/useStreamingQuery';
import {
  useQueryStore,
  type QueryTab as QueryTabType,
} from '../../store/queryStore';
import { formatDuration } from '../../utils/columnTooltips';

interface Props {
  tab: QueryTabType;
}

export default function QueryTab({ tab }: Props) {
  const updateTab = useQueryStore((s) => s.updateTab);
  const { execute } = useStreamingQuery();

  const handleRun = () => {
    if (!tab.sql.trim()) return;
    execute(tab.id, tab.sql);
  };

  const totalRows = tab.totalRowCount ?? tab.rows.length;
  const isCapped = tab.totalRowCount != null && tab.rows.length < tab.totalRowCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0, minHeight: 0 }}>
      {/* Editor */}
      <SqlEditor
        value={tab.sql}
        onChange={(sql) => updateTab(tab.id, { sql })}
        onRun={handleRun}
      />

      {/* Toolbar */}
      <div className="sr-toolbar">
        <Tooltip title="Execute query (Ctrl+Enter)">
          <Button
            type="primary"
            icon={<CaretRightOutlined />}
            loading={tab.loading}
            onClick={handleRun}
            style={{ borderRadius: 8, fontWeight: 500 }}
          >
            Run
          </Button>
        </Tooltip>

        <div className="toolbar-separator" />

        <ExportBar sql={tab.sql} disabled={!tab.sql.trim() || tab.loading} />

        <ExplainButton sql={tab.sql} disabled={!tab.sql.trim() || tab.loading} />
        <ExportFilesButton sql={tab.sql} disabled={!tab.sql.trim() || tab.loading} />

        <div className="toolbar-separator" />

        <QuerySettings />

        <JsonGuide />
        <QueryGuide />

        <div className="toolbar-info">
          {tab.limitApplied && (
            <Tooltip title="Auto LIMIT was added to your query. You can change this in Query Settings.">
              <Tag
                icon={<FilterOutlined />}
                color="blue"
                style={{ borderRadius: 4, margin: 0, cursor: 'help' }}
              >
                Auto LIMIT
              </Tag>
            </Tooltip>
          )}
          {tab.executionTimeMs != null && !tab.error && !tab.loading && (
            <Tag
              icon={<CheckCircleOutlined />}
              color="green"
              style={{ borderRadius: 4, margin: 0 }}
            >
              Success
            </Tag>
          )}
          {tab.executionTimeMs != null && (
            <Tooltip title="Total query execution time including network transfer">
              <Tag
                icon={<ClockCircleOutlined />}
                color="default"
                style={{ borderRadius: 4, margin: 0 }}
              >
                {formatDuration(tab.executionTimeMs)}
              </Tag>
            </Tooltip>
          )}
          {totalRows > 0 && (
            <Tooltip
              title={
                isCapped
                  ? `Showing ${tab.rows.length.toLocaleString()} of ${totalRows.toLocaleString()} total rows (display capped). Change Max Display Rows in settings.`
                  : `${totalRows.toLocaleString()} rows returned`
              }
            >
              <Tag
                icon={isCapped ? <WarningOutlined /> : <TableOutlined />}
                color={isCapped ? 'orange' : 'default'}
                style={{ borderRadius: 4, margin: 0 }}
              >
                {isCapped
                  ? `${tab.rows.length.toLocaleString()} / ${totalRows.toLocaleString()}`
                  : `${totalRows.toLocaleString()} rows`}
              </Tag>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Error */}
      {tab.error && (
        <Alert
          type="error"
          message="Query Error"
          description={tab.error}
          closable
          showIcon
          style={{ borderRadius: 8 }}
        />
      )}

      {/* Results */}
      <Spin spinning={tab.loading} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab.columns.length > 0 ? (
          <ResultTable columns={tab.columns} columnTypes={tab.columnTypes} rows={tab.rows} />
        ) : !tab.loading && !tab.error && tab.executionTimeMs != null ? (
          <div
            className="sr-empty-state"
            style={{ padding: '32px 24px' }}
          >
            <CheckCircleOutlined
              className="empty-icon"
              style={{ fontSize: 36, color: '#52c41a' }}
            />
            <div className="empty-title">Query executed successfully</div>
            <div className="empty-desc">
              The query completed in {formatDuration(tab.executionTimeMs)} with no result rows.
            </div>
          </div>
        ) : !tab.loading && !tab.error ? (
          <div
            className="sr-empty-state"
            style={{ padding: '32px 24px' }}
          >
            <TableOutlined
              className="empty-icon"
              style={{ fontSize: 36 }}
            />
            <div className="empty-title">Write a SQL query</div>
            <div className="empty-desc">
              Enter a SQL query in the editor above and press Run or Ctrl+Enter
              to execute it. Results will appear here.
            </div>
          </div>
        ) : null}
      </Spin>
    </div>
  );
}
