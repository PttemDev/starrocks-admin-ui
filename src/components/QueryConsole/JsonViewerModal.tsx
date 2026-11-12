import { Modal, Button, Space, message } from 'antd';
import { CopyOutlined, CompressOutlined, ExpandOutlined } from '@ant-design/icons';
import { Editor } from '@monaco-editor/react';
import { useState } from 'react';
import { useTheme } from '../../hooks/useTheme';

interface Props {
  open: boolean;
  title: string;
  value: string;
  onClose: () => void;
}

export default function JsonViewerModal({ open, title, value, onClose }: Props) {
  const { isDark } = useTheme();
  const [compact, setCompact] = useState(false);

  let parsed: unknown;
  let isValid = false;
  try {
    parsed = JSON.parse(value);
    isValid = true;
  } catch {
    // not valid JSON
  }

  const formatted = isValid
    ? compact
      ? JSON.stringify(parsed)
      : JSON.stringify(parsed, null, 2)
    : value;

  const handleCopy = () => {
    navigator.clipboard.writeText(formatted);
    message.success('JSON copied');
  };

  const handleCopyMinified = () => {
    const minified = isValid ? JSON.stringify(parsed) : value;
    navigator.clipboard.writeText(minified);
    message.success('Minified JSON copied');
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
          <span>{title}</span>
          <Space size={4}>
            <Button
              type="text"
              size="small"
              icon={compact ? <ExpandOutlined /> : <CompressOutlined />}
              onClick={() => setCompact(!compact)}
              title={compact ? 'Pretty print' : 'Minify'}
            />
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              title="Copy formatted"
            >
              Copy
            </Button>
            {isValid && (
              <Button
                type="text"
                size="small"
                onClick={handleCopyMinified}
                title="Copy minified"
              >
                Copy minified
              </Button>
            )}
          </Space>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ height: 480, borderRadius: 4, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <Editor
          language="json"
          value={formatted}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 13,
            folding: true,
            automaticLayout: true,
          }}
          theme={isDark ? 'vs-dark' : 'vs-light'}
        />
      </div>
    </Modal>
  );
}
