import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SettingsState = {
  apiKey: string;
  backendOverride: string;
  refreshIntervalSec: number;
  setApiKey: (key: string) => void;
  setBackendOverride: (url: string) => void;
  setRefreshInterval: (n: number) => void;
  clear: () => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      apiKey: '',
      backendOverride: '',
      refreshIntervalSec: 30,
      setApiKey: (apiKey) => set({ apiKey }),
      setBackendOverride: (backendOverride) => set({ backendOverride }),
      setRefreshInterval: (refreshIntervalSec) => set({ refreshIntervalSec }),
      clear: () => set({ apiKey: '', backendOverride: '' }),
    }),
    { name: 'noc-settings' },
  ),
);
