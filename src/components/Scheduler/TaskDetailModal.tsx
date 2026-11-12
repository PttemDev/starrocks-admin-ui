import { useEffect, useState } from 'react';
import {
  Modal, Button, Space, message, Input, InputNumber, Select, Switch, Typography, Tag, Form,
} from 'antd';
import { CopyOutlined, SaveOutlined } from '@ant-design/icons';
import { Editor } from '@monaco-editor/react';
import { updateScheduledTask } from '../../api/client';
import { useTheme } from '../../hooks/useTheme';

interface Props {
  open: boolean;
  task: Record<string, unknown> | null;
  env: string;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type Unit = 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';

// Parse "PERIODICAL START(2026-04-09T21:30) EVERY(1 DAYS)" → fields.
function parseSchedule(s: string): { recurring: boolean; every: number; unit: Unit; start: string } {
  const everyM = s?.match(/EVERY\((\d+)\s*([A-Za-z]+)\)/);
  const startM = s?.match(/START\(([^)]+)\)/);
  let unit = (everyM?.[2] || 'DAY').toUpperCase().replace(/S$/, '');
  if (!['SECOND', 'MINUTE', 'HOUR', 'DAY'].includes(unit)) unit = 'DAY';
  let start = startM ? startM[1].trim().replace('T', ' ') : '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(start)) start += ':00';
  return {
    recurring: !!everyM,
    every: everyM ? parseInt(everyM[1], 10) : 1,
    unit: unit as Unit,
    start,
  };
}

export default function TaskDetailModal({ open, task, env, canEdit, onClose, onSaved }: Props) {
  const { isDark } = useTheme();
  const [sqlBody, setSqlBody] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [every, setEvery] = useState(1);
  const [unit, setUnit] = useState<Unit>('DAY');
  const [start, setStart] = useState('');
  const [saving, setSaving] = useState(false);

  const name = String(task?.TaskName || '');
  const schedule = String(task?.Schedule || '');

  useEffect(() => {
    if (open && task) {
      setSqlBody(String(task.Definition || ''));
      const p = parseSchedule(schedule);
      setRecurring(p.recurring);
      setEvery(p.every);
      setUnit(p.unit);
      setStart(p.start);
      setSaving(false);
    }
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildSubmitSql = (): string => {
    const body = sqlBody.trim().replace(/;\s*$/, '');
    const startClause = recurring && start ? `START("${start}") ` : '';
    const sched = recurring ? `\nSCHEDULE ${startClause}EVERY(INTERVAL ${every} ${unit})` : '';
    return `SUBMIT TASK \`${name}\`${sched}\nAS\n${body};`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlBody);
    message.success('SQL copied');
  };

  const handleSave = async () => {
    if (!sqlBody.trim()) {
      message.error('SQL cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await updateScheduledTask(env, name, buildSubmitSql(), String(task?.DbName || ''));
      message.success('Task updated');
      onSaved();
    } catch (err) {
      message.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
          <span>Scheduled Task — <code>{name}</code></span>
          <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy}>Copy SQL</Button>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={840}
      footer={
        <Space>
          <Button onClick={onClose}>Close</Button>
          {canEdit && (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              Save (recreate task)
            </Button>
          )}
        </Space>
      }
    >
      {/* Schedule */}
      {canEdit ? (
        <Form layout="vertical" size="small" style={{ marginBottom: 12 }}>
          <Space size={16} align="center" wrap>
            <Space size={6}>
              <Typography.Text strong style={{ fontSize: 13 }}>Recurring</Typography.Text>
              <Switch checked={recurring} onChange={setRecurring} size="small" />
            </Space>
            {recurring && (
              <>
                <Form.Item label="Every" style={{ marginBottom: 0 }}>
                  <InputNumber value={every} onChange={(v) => setEvery(v || 1)} min={1} style={{ width: 90 }} />
                </Form.Item>
                <Form.Item label="Unit" style={{ marginBottom: 0 }}>
                  <Select
                    value={unit}
                    onChange={(v) => setUnit(v as Unit)}
                    style={{ width: 120 }}
                    options={[
                      { value: 'SECOND', label: 'Second(s)' },
                      { value: 'MINUTE', label: 'Minute(s)' },
                      { value: 'HOUR', label: 'Hour(s)' },
                      { value: 'DAY', label: 'Day(s)' },
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Start (optional)" style={{ marginBottom: 0 }} tooltip="Format: YYYY-MM-DD HH:mm:ss. Empty = start immediately.">
                  <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="2026-06-04 03:00:00" style={{ width: 200 }} />
                </Form.Item>
              </>
            )}
          </Space>
        </Form>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong style={{ fontSize: 13, marginRight: 8 }}>Schedule:</Typography.Text>
          {schedule
            ? <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>{schedule}</Tag>
            : <Typography.Text type="secondary">manual</Typography.Text>}
        </div>
      )}

      {/* Definition SQL */}
      <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
        Definition (the statement the task runs)
      </Typography.Text>
      <div style={{ height: 360, borderRadius: 4, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <Editor
          language="sql"
          value={sqlBody}
          onChange={(v) => setSqlBody(v || '')}
          options={{
            readOnly: !canEdit,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 13,
            automaticLayout: true,
          }}
          theme={isDark ? 'vs-dark' : 'vs-light'}
        />
      </div>
      {canEdit && (
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
          StarRocks can't alter a task in place — saving drops <code>{name}</code> and recreates it with the edited SQL and schedule.
        </Typography.Text>
      )}
    </Modal>
  );
}
