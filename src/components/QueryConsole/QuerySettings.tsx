import { useState } from 'react';
import { Popover, Form, InputNumber, Switch, Input, Space, Typography, Tooltip, Button } from 'antd';
import { SettingOutlined, InfoCircleOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../store/settingsStore';

function SessionVariablesEditor() {
  const { query, updateQuery } = useSettingsStore();
  const vars = query.sessionVariables ?? {};
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const addVar = () => {
    const key = newKey.trim();
    const val = newValue.trim();
    if (!key || !val) return;
    updateQuery({ sessionVariables: { ...vars, [key]: val } });
    setNewKey('');
    setNewValue('');
  };

  const removeVar = (key: string) => {
    const next = { ...vars };
    delete next[key];
    updateQuery({ sessionVariables: next });
  };

  const entries = Object.entries(vars);

  return (
    <div>
      <Space size={4} style={{ marginBottom: 8 }}>
        <Typography.Text strong style={{ fontSize: 12 }}>Session Variables</Typography.Text>
        <Tooltip title="SET key = value commands executed on the connection before each query. Useful for optimizer hints like enable_topn_opt, query_timeout, etc.">
          <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)', fontSize: 12 }} />
        </Tooltip>
      </Space>

      {entries.map(([key, value]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
          <Input size="small" value={key} disabled style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
          <span style={{ color: 'var(--sr-text-muted)', fontSize: 12 }}>=</span>
          <Input size="small" value={value} disabled style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => removeVar(key)}
            style={{ color: '#ef4444', flexShrink: 0 }}
          />
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Input
          size="small"
          placeholder="variable"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onPressEnter={addVar}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
        />
        <span style={{ color: 'var(--sr-text-muted)', fontSize: 12 }}>=</span>
        <Input
          size="small"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onPressEnter={addVar}
          style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
        />
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={addVar}
          disabled={!newKey.trim() || !newValue.trim()}
          style={{ flexShrink: 0 }}
        />
      </div>
    </div>
  );
}

export default function QuerySettings() {
  const { query, updateQuery } = useSettingsStore();
  const varCount = Object.keys(query.sessionVariables ?? {}).length;

  const content = (
    <div style={{ width: 320 }}>
      <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        Query Settings
      </Typography.Text>

      <Form layout="vertical" size="small" style={{ marginBottom: 0 }}>
        <Form.Item style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space size={4}>
              <span>Auto LIMIT</span>
              <Tooltip title="Automatically appends a LIMIT clause to SELECT queries that don't have one. Prevents accidentally fetching millions of rows and freezing the UI.">
                <InfoCircleOutlined style={{ color: 'var(--sr-text-muted)', fontSize: 12 }} />
              </Tooltip>
            </Space>
            <Switch
              size="small"
              checked={query.autoLimit}
              onChange={(v) => updateQuery({ autoLimit: v })}
            />
          </div>
        </Form.Item>

        {query.autoLimit && (
          <Form.Item
            label="Default LIMIT"
            tooltip="Number of rows to limit when no LIMIT is present in the query."
            style={{ marginBottom: 12 }}
          >
            <InputNumber
              value={query.defaultLimit}
              onChange={(v) => updateQuery({ defaultLimit: v || 100 })}
              min={1}
              max={100000}
              step={100}
              style={{ width: '100%' }}
            />
          </Form.Item>
        )}

        <Form.Item
          label="Query Timeout"
          tooltip="Maximum time in seconds before a query is cancelled. Prevents long-running queries from consuming cluster resources."
          style={{ marginBottom: 12 }}
        >
          <InputNumber
            value={query.queryTimeout}
            onChange={(v) => updateQuery({ queryTimeout: v || 300 })}
            min={1}
            max={3600}
            addonAfter="sec"
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          label="Max Display Rows"
          tooltip="Maximum rows to render in the result table. Rows beyond this are fetched but not displayed. Keeps the browser responsive."
          style={{ marginBottom: 12 }}
        >
          <InputNumber
            value={query.maxDisplayRows}
            onChange={(v) => updateQuery({ maxDisplayRows: v || 50000 })}
            min={100}
            max={500000}
            step={1000}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>

      <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, marginBottom: 8 }}>
        <SessionVariablesEditor />
      </div>

      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        Settings are saved to your browser.
      </Typography.Text>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
    >
      <Tooltip title="Query settings">
        <Button
          type="text"
          size="small"
          icon={<SettingOutlined />}
          style={{ borderRadius: 6 }}
        >
          {(query.autoLimit || varCount > 0) && (
            <span style={{ fontSize: 11, color: 'var(--sr-text-secondary)' }}>
              {[
                query.autoLimit ? `LIMIT ${query.defaultLimit}` : '',
                varCount > 0 ? `${varCount} var${varCount > 1 ? 's' : ''}` : '',
              ].filter(Boolean).join(' · ')}
            </span>
          )}
        </Button>
      </Tooltip>
    </Popover>
  );
}
