import { useState } from 'react';
import { Drawer, Button, Tooltip, Tag, Empty, Popconfirm, Input } from 'antd';
import {
  HistoryOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  TableOutlined,
  DeleteOutlined,
  SearchOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useHistoryStore, type QueryHistoryEntry } from '../../store/historyStore';
import { useQueryStore } from '../../store/queryStore';
import { useEnvStore } from '../../store/envStore';
import { formatDuration } from '../../utils/columnTooltips';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function HistoryItem({ entry, onClose }: { entry: QueryHistoryEntry; onClose: () => void }) {
  const addTabWithSql = useQueryStore((s) => s.addTabWithSql);
  const environments = useEnvStore((s) => s.environments);
  const envDisplay = environments.find((e) => e.name === entry.env)?.display_name || entry.env;

  const isError = entry.status === 'error';
  const sqlPreview = entry.sql.trim().replace(/\s+/g, ' ');

  const handleOpen = () => {
    addTabWithSql(entry.sql, 'History');
    onClose();
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '10px 12px',
        borderBottom: '1px solid #f1f5f9',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sr-card-alt)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Open in new tab button — left side */}
      <Tooltip title="Open in new tab">
        <Button
          type="text"
          size="small"
          icon={<PlayCircleOutlined />}
          onClick={handleOpen}
          style={{
            color: 'var(--sr-text-muted)',
            fontSize: 14,
            flexShrink: 0,
            marginTop: 1,
          }}
        />
      </Tooltip>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* SQL preview */}
        <div
          style={{
            fontSize: 12,
            fontFamily: 'monospace',
            color: isError ? '#ef4444' : 'var(--sr-text)',
            lineHeight: '18px',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            wordBreak: 'break-all',
          }}
        >
          {sqlPreview}
        </div>

        {/* Metadata row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 6,
            fontSize: 11,
            color: 'var(--sr-text-muted)',
            flexWrap: 'wrap',
          }}
        >
          {isError ? (
            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 3 }}>
              <CloseCircleOutlined style={{ fontSize: 10 }} /> Error
            </span>
          ) : (
            <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 3 }}>
              <CheckCircleOutlined style={{ fontSize: 10 }} /> OK
            </span>
          )}

          <span style={{ color: 'var(--sr-text-faint)' }}>|</span>

          <span>{envDisplay}</span>

          {entry.durationMs != null && (
            <>
              <span style={{ color: 'var(--sr-text-faint)' }}>|</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <ClockCircleOutlined style={{ fontSize: 10 }} />
                {formatDuration(entry.durationMs)}
              </span>
            </>
          )}

          {entry.rowCount != null && (
            <>
              <span style={{ color: 'var(--sr-text-faint)' }}>|</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <TableOutlined style={{ fontSize: 10 }} />
                {entry.rowCount.toLocaleString()} rows
              </span>
            </>
          )}

          <span style={{ color: 'var(--sr-text-faint)' }}>|</span>
          <span>{timeAgo(entry.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

export default function QueryHistory() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const entries = useHistoryStore((s) => s.entries);
  const clearHistory = useHistoryStore((s) => s.clearHistory);

  const filtered = filter
    ? entries.filter((e) => e.sql.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <>
      <Tooltip title="Query history">
        <Button
          type="text"
          icon={<HistoryOutlined />}
          onClick={() => setOpen(true)}
          size="small"
          style={{ marginRight: 4 }}
        />
      </Tooltip>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HistoryOutlined style={{ color: '#6366f1' }} />
            <span style={{ flex: 1 }}>Query History</span>
            <Tag style={{ margin: 0, borderRadius: 4 }}>{entries.length}</Tag>
          </div>
        }
        placement="right"
        width={420}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          entries.length > 0 && (
            <Popconfirm
              title="Clear all history?"
              onConfirm={clearHistory}
              okText="Clear"
              okType="danger"
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                size="small"
              >
                Clear
              </Button>
            </Popconfirm>
          )
        }
        styles={{
          body: { padding: 0, display: 'flex', flexDirection: 'column' },
        }}
      >
        {/* Search */}
        {entries.length > 0 && (
          <div style={{ padding: '12px 12px 8px' }}>
            <Input
              prefix={<SearchOutlined style={{ color: 'var(--sr-text-faint)', fontSize: 12 }} />}
              placeholder="Search queries..."
              size="small"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              allowClear
              style={{ borderRadius: 6, fontSize: 12 }}
            />
          </div>
        )}

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                entries.length === 0
                  ? 'No queries executed yet'
                  : 'No matching queries'
              }
              style={{ marginTop: 80 }}
            />
          ) : (
            filtered.map((entry) => (
              <HistoryItem key={entry.id} entry={entry} onClose={() => setOpen(false)} />
            ))
          )}
        </div>
      </Drawer>
    </>
  );
}
