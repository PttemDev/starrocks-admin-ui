import { create } from 'zustand';
import { fetchDatabases, fetchTables, fetchColumns } from '../api/client';
import type { ColumnInfo } from '../api/types';

interface SchemaState {
  databases: string[];
  /** db -> table names */
  tables: Record<string, string[]>;
  /** "db.table" -> columns */
  columns: Record<string, ColumnInfo[]>;
  /** Which db tree nodes are expanded */
  expandedDbs: string[];
  /** Currently loading something */
  loading: boolean;

  loadDatabases: (env: string) => Promise<void>;
  loadTables: (env: string, db: string) => Promise<void>;
  loadColumns: (env: string, db: string, table: string) => Promise<void>;
  toggleDb: (db: string) => void;
  reset: () => void;
}

export const useSchemaStore = create<SchemaState>()((set, get) => ({
  databases: [],
  tables: {},
  columns: {},
  expandedDbs: [],
  loading: false,

  loadDatabases: async (env) => {
    set({ loading: true });
    try {
      const dbs = await fetchDatabases(env);
      const filtered = dbs.filter((db) => !db.startsWith('_') && db !== 'information_schema' && db !== 'sys');
      set({ databases: filtered, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadTables: async (env, db) => {
    try {
      const tbls = await fetchTables(env, db);
      set((s) => ({ tables: { ...s.tables, [db]: tbls } }));
    } catch {
      // silently fail
    }
  },

  loadColumns: async (env, db, table) => {
    const key = `${db}.${table}`;
    try {
      const cols = await fetchColumns(env, db, table);
      set((s) => ({ columns: { ...s.columns, [key]: cols } }));
    } catch {
      // silently fail
    }
  },

  toggleDb: (db) => {
    set((s) => {
      const expanded = s.expandedDbs.includes(db)
        ? s.expandedDbs.filter((d) => d !== db)
        : [...s.expandedDbs, db];
      return { expandedDbs: expanded };
    });
  },

  reset: () =>
    set({ databases: [], tables: {}, columns: {}, expandedDbs: [] }),
}));
