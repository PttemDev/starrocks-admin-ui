import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  env: string;
  timestamp: number;
  durationMs: number | null;
  rowCount: number | null;
  columnCount: number;
  status: 'success' | 'error';
  error?: string;
}

const MAX_ENTRIES = 500;

interface HistoryState {
  entries: QueryHistoryEntry[];
  addEntry: (entry: Omit<QueryHistoryEntry, 'id'>) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],

      addEntry: (entry) =>
        set((state) => ({
          entries: [
            {
              ...entry,
              id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            },
            ...state.entries,
          ].slice(0, MAX_ENTRIES),
        })),

      clearHistory: () => set({ entries: [] }),
    }),
    {
      name: 'starrocks-query-history',
    },
  ),
);
