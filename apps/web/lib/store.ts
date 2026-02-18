"use client";

import { create } from "zustand";

type MonitorState = {
  pageSize: number;
  autoRefresh: boolean;
  setPageSize: (pageSize: number) => void;
  toggleRefresh: () => void;
};

export const useMonitorStore = create<MonitorState>((set) => ({
  pageSize: 20,
  autoRefresh: false,
  setPageSize: (pageSize) => set({ pageSize }),
  toggleRefresh: () => set((state) => ({ autoRefresh: !state.autoRefresh })),
}));
