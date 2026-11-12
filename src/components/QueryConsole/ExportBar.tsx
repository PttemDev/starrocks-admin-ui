import { Button, Tooltip, Space } from 'antd';
import {
  FileExcelOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useExport, type ExportFormat } from '../../hooks/useExport';

interface Props {
  sql: string;
  disabled: boolean;
}

const FORMATS: { format: ExportFormat; label: string; icon: React.ReactNode; tip: string }[] = [
  { format: 'csv', label: 'CSV', icon: <FileTextOutlined />, tip: 'Export results as CSV file' },
  { format: 'excel', label: 'Excel', icon: <FileExcelOutlined />, tip: 'Export results as Excel spreadsheet (.xlsx)' },
  { format: 'json', label: 'JSON', icon: <CodeOutlined />, tip: 'Export results as JSON array' },
];

export default function ExportBar({ sql, disabled }: Props) {
  const { doExport, exporting } = useExport();

  return (
    <Space size={4}>
      {FORMATS.map(({ format, label, icon, tip }) => (
        <Tooltip
          key={format}
          title={exporting ? 'Export in progress…' : tip}
        >
          <Button
            icon={icon}
            size="small"
            // Every button locks while any export runs: they all hit the same
            // endpoint and a second click re-runs the query on the cluster.
            disabled={disabled || (exporting !== null && exporting !== format)}
            loading={exporting === format}
            onClick={() => doExport(sql, format)}
            style={{ borderRadius: 6 }}
          >
            {label}
          </Button>
        </Tooltip>
      ))}
    </Space>
  );
}
