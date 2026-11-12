import { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import { exportData } from '../api/client';
import { useEnvStore } from '../store/envStore';

export type ExportFormat = 'csv' | 'excel' | 'json';

export function useExport() {
  const selectedEnv = useEnvStore((s) => s.selectedEnv);
  /** Format currently being exported, or null when idle. */
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  // A ref as well as state: the guard must reject a second click fired before
  // React has re-rendered the disabled button.
  const busy = useRef(false);

  const doExport = useCallback(
    async (sql: string, format: ExportFormat) => {
      if (!selectedEnv || !sql.trim() || busy.current) return;
      busy.current = true;
      setExporting(format);
      const hide = message.loading(
        `Preparing ${format.toUpperCase()} export…`,
        0,
      );
      try {
        await exportData(selectedEnv, { sql, format });
      } catch (err) {
        message.error(
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        hide();
        busy.current = false;
        setExporting(null);
      }
    },
    [selectedEnv],
  );

  return { doExport, exporting };
}
