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
  autoRefresh: typeof window !== "undefined" && localStorage.getItem("ui.live.autoRefresh") === "true",
  setPageSize: (pageSize) => set({ pageSize }),
  toggleRefresh: () =>
    set((state) => {
      const next = !state.autoRefresh;
      if (typeof window !== "undefined") {
        localStorage.setItem("ui.live.autoRefresh", String(next));
      }
      return { autoRefresh: next };
    }),
}));
