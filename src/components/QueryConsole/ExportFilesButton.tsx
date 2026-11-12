import { useState } from 'react';
import { Button, Modal, Tooltip, message, Input, Select, Form, Alert, Typography } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import { exportToFiles } from '../../api/client';
import { useEnvStore } from '../../store/envStore';

// Unloads the current query's result to object storage (GCS/S3) via
// INSERT INTO FILES(...). For GCS the cluster authenticates itself (core-site.xml),
// so only a destination path + format are needed.
export default function ExportFilesButton({ sql, disabled }: { sql: string; disabled?: boolean }) {
  const env = useEnvStore((s) => s.selectedEnv);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [format, setFormat] = useState('parquet');
  const [loading, setLoading] = useState(false);

  const generated = () => {
    const params = [`"path" = "${path}"`, `"format" = "${format}"`];
    return `INSERT INTO FILES(\n    ${params.join(',\n    ')}\n)\n${sql.trim().replace(/;\s*$/, '')}`;
  };

  const run = async () => {
    if (!env || !path.trim() || !sql.trim()) return;
    setLoading(true);
    try {
      await exportToFiles(env, generated());
      message.success(`Export written under ${path}`);
      setOpen(false);
    } catch (e) {
      message.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Tooltip title="Export this query's result to object storage (GCS/S3) as files">
        <Button type="text" size="small" icon={<CloudUploadOutlined />} disabled={disabled} onClick={() => setOpen(true)}>
          Export → files
        </Button>
      </Tooltip>
      <Modal
        title="Export to object storage"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={run}
        confirmLoading={loading}
        okText="Export"
        okButtonProps={{ disabled: !path.trim() }}
        width={680}
      >
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 8, marginBottom: 12 }}
          message="Unload via INSERT INTO FILES()"
          description="The current query's result is written as one or more files under the path prefix. For GCS the cluster authenticates itself (core-site.xml) — just give a gs:// prefix. (S3 would also work with an s3:// prefix if the cluster has those creds.)"
        />
        <Form layout="vertical" size="small">
          <Form.Item label="Destination path (prefix)" required tooltip="Files are written under this prefix, e.g. gs://bucket/export/orders/">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="gs://my-bucket/export/orders/" />
          </Form.Item>
          <Form.Item label="Format">
            <Select
              value={format}
              onChange={setFormat}
              style={{ width: 160 }}
              options={[
                { value: 'parquet', label: 'Parquet' },
                { value: 'csv', label: 'CSV' },
                { value: 'orc', label: 'ORC' },
              ]}
            />
          </Form.Item>
        </Form>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Generated statement:</Typography.Text>
        <pre style={{
          margin: '4px 0 0', padding: 10, background: 'var(--sr-code-bg)', color: 'var(--sr-code-fg)', borderRadius: 8,
          fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 180, overflow: 'auto',
        }}>
          {path ? generated() : '—'}
        </pre>
      </Modal>
    </>
  );
}
