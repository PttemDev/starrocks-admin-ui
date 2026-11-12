import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface QuerySettings {
  /** Auto-add LIMIT if user query has no LIMIT clause */
  autoLimit: boolean;
  /** Default LIMIT value when autoLimit is true */
  defaultLimit: number;
  /** Query timeout in seconds (sent as hint to backend) */
  queryTimeout: number;
  /** Whether to show the result row count in the toolbar */
  showRowCount: boolean;
  /** Max rows to display in the result table (client-side cap) */
  maxDisplayRows: number;
  /** Session variables sent as SET key=value before each query */
  sessionVariables: Record<string, string>;
}

/** "system" follows the OS setting via matchMedia; the other two pin it. */
export type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsState {
  query: QuerySettings;
  updateQuery: (patch: Partial<QuerySettings>) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      query: {
        autoLimit: true,
        defaultLimit: 100,
        queryTimeout: 300,
        showRowCount: true,
        maxDisplayRows: 50000,
        sessionVariables: {},
      },
      updateQuery: (patch) =>
        set((s) => ({ query: { ...s.query, ...patch } })),
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'starrocks-settings',
    },
  ),
);
