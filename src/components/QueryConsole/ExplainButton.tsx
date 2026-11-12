import { useState } from 'react';
import { Button, Modal, Tooltip, message, Radio, Space, Spin, Alert, Typography } from 'antd';
import { NodeIndexOutlined } from '@ant-design/icons';
import { runQuery } from '../../api/client';
import { useEnvStore } from '../../store/envStore';

type Mode = 'EXPLAIN' | 'EXPLAIN ANALYZE';

// Shows the query execution plan (EXPLAIN) or, optionally, the runtime profile
// (EXPLAIN ANALYZE — which actually executes the query).
export default function ExplainButton({ sql, disabled }: { sql: string; disabled?: boolean }) {
  const env = useEnvStore((s) => s.selectedEnv);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('EXPLAIN');
  const [plan, setPlan] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (m: Mode) => {
    if (!env || !sql.trim()) return;
    setLoading(true);
    setError(null);
    setPlan('');
    try {
      const res = await runQuery(env, `${m} ${sql.trim().replace(/;\s*$/, '')}`);
      setPlan(res.rows.map((r) => String(Object.values(r)[0] ?? '')).join('\n'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    setMode('EXPLAIN');
    run('EXPLAIN');
  };

  return (
    <>
      <Tooltip title="Show the query execution plan (and optionally run it for a profile)">
        <Button type="text" size="small" icon={<NodeIndexOutlined />} disabled={disabled} onClick={openModal}>
          Explain
        </Button>
      </Tooltip>
      <Modal
        title="Query plan"
        open={open}
        onCancel={() => setOpen(false)}
        width={860}
        footer={
          <Space>
            <Button onClick={() => { navigator.clipboard.writeText(plan); message.success('Plan copied'); }} disabled={!plan}>Copy</Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </Space>
        }
      >
        <Space style={{ marginBottom: 10 }} align="center">
          <Radio.Group
            value={mode}
            size="small"
            onChange={(e) => { setMode(e.target.value); run(e.target.value); }}
          >
            <Radio.Button value="EXPLAIN">Plan (EXPLAIN)</Radio.Button>
            <Radio.Button value="EXPLAIN ANALYZE">Profile (runs the query)</Radio.Button>
          </Radio.Group>
          {mode === 'EXPLAIN ANALYZE' && (
            <Typography.Text type="warning" style={{ fontSize: 11 }}>
              Executes the query to collect real timings.
            </Typography.Text>
          )}
        </Space>
        {error && <Alert type="error" showIcon message="Explain failed" description={error} style={{ marginBottom: 8, borderRadius: 8 }} />}
        <Spin spinning={loading}>
          <pre style={{
            margin: 0, padding: 12, background: 'var(--sr-code-bg)', color: 'var(--sr-code-fg)', borderRadius: 8,
            fontSize: 12, lineHeight: '17px', whiteSpace: 'pre', overflow: 'auto', maxHeight: 480, minHeight: 140,
          }}>
            {plan || (loading ? '' : 'No plan output.')}
          </pre>
        </Spin>
      </Modal>
    </>
  );
}
