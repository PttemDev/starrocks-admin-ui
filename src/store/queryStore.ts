import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEnvStore } from './envStore';

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  columns: string[];
  /** Column type names from StarRocks (e.g. "JSON", "VARCHAR", "INT") */
  columnTypes: string[];
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  executionTimeMs: number | null;
  /** Whether auto-LIMIT was applied to this execution */
  limitApplied?: boolean;
  /** Total rows fetched (before client-side capping) */
  totalRowCount?: number;
}

interface EnvTabs {
  tabs: QueryTab[];
  activeTabId: string;
}

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string;
  /** Per-environment tab storage */
  _envTabs: Record<string, EnvTabs>;
  /** Currently active environment (tracks which env `tabs` belongs to) */
  _currentEnv: string;

  switchEnv: (newEnv: string) => void;
  addTab: () => void;
  addTabWithSql: (sql: string, title?: string) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<QueryTab>) => void;
  renameTab: (id: string, title: string) => void;
  duplicateTab: (id: string) => void;
  moveTab: (fromId: string, toId: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
}

let tabCounter = 1;

/**
 * Next free "Query N" title. Derived from the tabs that actually exist rather
 * than a module counter, which resets to 1 on every page load and made reopened
 * sessions hand out titles that were already taken.
 */
function nextTitle(existing: QueryTab[]): string {
  let max = 0;
  for (const t of existing) {
    const m = /^Query (\d+)$/.exec(t.title);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Query ${max + 1}`;
}

function newTab(existing: QueryTab[] = []): QueryTab {
  const id = `tab-${Date.now()}-${tabCounter++}`;
  return {
    id,
    title: nextTitle(existing),
    sql: '',
    columns: [],
    columnTypes: [],
    rows: [],
    loading: false,
    error: null,
    executionTimeMs: null,
  };
}

function cleanTab(t: QueryTab): QueryTab {
  return {
    ...t,
    loading: false,
    error: null,
    rows: [],
    columns: [],
    columnTypes: [],
    executionTimeMs: null,
    limitApplied: undefined,
    totalRowCount: undefined,
  };
}

export const useQueryStore = create<QueryState>()(
  persist(
    (set, get) => ({
      tabs: [newTab()],
      activeTabId: '',
      _envTabs: {},
      _currentEnv: '',

      switchEnv: (newEnv) => {
        const { tabs, activeTabId, _currentEnv, _envTabs } = get();
        if (newEnv === _currentEnv) return;

        // Save current tabs for the old environment
        const updated = { ..._envTabs };
        if (_currentEnv) {
          updated[_currentEnv] = { tabs, activeTabId };
        }

        // Load tabs for the new environment
        const envState = updated[newEnv];
        if (envState && envState.tabs.length > 0) {
          set({
            tabs: envState.tabs,
            activeTabId: envState.activeTabId || envState.tabs[0].id,
            _envTabs: updated,
            _currentEnv: newEnv,
          });
        } else {
          // First time on this env — create a blank tab
          const tab = newTab();
          set({
            tabs: [tab],
            activeTabId: tab.id,
            _envTabs: updated,
            _currentEnv: newEnv,
          });
        }
      },

      addTab: () => {
        const tab = newTab(get().tabs);
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: tab.id,
        }));
      },

      addTabWithSql: (sql, title) => {
        const tab = newTab(get().tabs);
        tab.sql = sql;
        if (title) tab.title = title;
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: tab.id,
        }));
      },

      removeTab: (id) => {
        const { tabs, activeTabId } = get();
        if (tabs.length <= 1) return;
        const idx = tabs.findIndex((t) => t.id === id);
        const newTabs = tabs.filter((t) => t.id !== id);
        const newActive =
          activeTabId === id
            ? newTabs[Math.min(idx, newTabs.length - 1)]?.id || ''
            : activeTabId;
        set({ tabs: newTabs, activeTabId: newActive });
      },

      setActiveTab: (id) => set({ activeTabId: id }),

      renameTab: (id, title) => {
        const trimmed = title.trim();
        if (!trimmed) return;
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
        }));
      },

      duplicateTab: (id) => {
        const { tabs } = get();
        const src = tabs.find((t) => t.id === id);
        if (!src) return;
        const tab = newTab(tabs);
        tab.sql = src.sql;
        tab.title = `${src.title} (copy)`;
        const idx = tabs.findIndex((t) => t.id === id);
        set({
          tabs: [...tabs.slice(0, idx + 1), tab, ...tabs.slice(idx + 1)],
          activeTabId: tab.id,
        });
      },

      moveTab: (fromId, toId) => {
        if (fromId === toId) return;
        const { tabs } = get();
        const from = tabs.findIndex((t) => t.id === fromId);
        const to = tabs.findIndex((t) => t.id === toId);
        if (from < 0 || to < 0) return;
        const next = [...tabs];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        set({ tabs: next });
      },

      closeOtherTabs: (id) => {
        const { tabs } = get();
        const keep = tabs.find((t) => t.id === id);
        if (!keep) return;
        set({ tabs: [keep], activeTabId: keep.id });
      },

      closeTabsToRight: (id) => {
        const { tabs, activeTabId } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < 0 || idx === tabs.length - 1) return;
        const next = tabs.slice(0, idx + 1);
        // The active tab may have been among the ones just closed.
        const stillOpen = next.some((t) => t.id === activeTabId);
        set({ tabs: next, activeTabId: stillOpen ? activeTabId : id });
      },

      updateTab: (id, patch) =>
        set((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
    }),
    {
      name: 'starrocks-queries',
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 1) {
          // v0 → v1: tabs were global, now per-env
          // Keep existing tabs as-is; they'll be saved to whichever env is active
          if (!state._envTabs) state._envTabs = {};
          if (!state._currentEnv) state._currentEnv = '';
        }
        return state as unknown as QueryState;
      },
      partialize: (state) => {
        // Merge current tabs into _envTabs before persisting
        const envTabs = { ...state._envTabs };
        if (state._currentEnv) {
          envTabs[state._currentEnv] = {
            tabs: state.tabs.map(cleanTab),
            activeTabId: state.activeTabId,
          };
        }
        // Clean all env tabs for storage
        const cleanedEnvTabs: Record<string, EnvTabs> = {};
        for (const [env, data] of Object.entries(envTabs)) {
          cleanedEnvTabs[env] = {
            tabs: data.tabs.map(cleanTab),
            activeTabId: data.activeTabId,
          };
        }
        return {
          tabs: state.tabs.map(cleanTab),
          activeTabId: state.activeTabId,
          _envTabs: cleanedEnvTabs,
          _currentEnv: state._currentEnv,
        } as unknown as QueryState;
      },
    },
  ),
);

// Set initial active tab
const initState = useQueryStore.getState();
if (!initState.activeTabId && initState.tabs.length > 0) {
  useQueryStore.setState({ activeTabId: initState.tabs[0].id });
}

// Auto-switch query tabs when environment changes
useEnvStore.subscribe((state, prevState) => {
  if (state.selectedEnv && state.selectedEnv !== prevState.selectedEnv) {
    useQueryStore.getState().switchEnv(state.selectedEnv);
  }
});
