import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Environment } from '../api/types';

interface EnvState {
  environments: Environment[];
  selectedEnv: string;
  setEnvironments: (envs: Environment[]) => void;
  setSelectedEnv: (name: string) => void;
}

export const useEnvStore = create<EnvState>()(
  persist(
    (set) => ({
      environments: [],
      selectedEnv: '',
      setEnvironments: (envs) =>
        set((state) => ({
          environments: envs,
          selectedEnv: state.selectedEnv || envs[0]?.name || '',
        })),
      setSelectedEnv: (name) => set({ selectedEnv: name }),
    }),
    {
      name: 'starrocks-env',
      partialize: (state) => ({ selectedEnv: state.selectedEnv }),
    },
  ),
);
