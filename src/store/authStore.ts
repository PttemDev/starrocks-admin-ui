import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'admin' | 'viewer';

interface AuthState {
  token: string;
  role: UserRole;
  username: string;
  isLoggedIn: boolean;
  login: (token: string, role: UserRole, username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: '',
      role: 'admin' as UserRole,
      username: '',
      isLoggedIn: false,
      login: (token, role, username) => set({ token, role, username, isLoggedIn: true }),
      logout: () => set({ token: '', role: 'viewer', username: '', isLoggedIn: false }),
    }),
    {
      name: 'starrocks-auth',
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 1 || !state.role) {
          state.role = 'admin';
        }
        if (version < 2 || !state.username) {
          state.username = state.role === 'admin' ? 'admin' : 'user';
        }
        return state as unknown as AuthState;
      },
    },
  ),
);
