"use client";

import { Group, Paper } from "@mantine/core";
import { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group align="end" gap="md" wrap="wrap">
        {children}
      </Group>
    </Paper>
  );
}
