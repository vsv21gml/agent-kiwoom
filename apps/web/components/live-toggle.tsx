"use client";

import { ActionIcon, Badge, Group, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useMonitorStore } from "@/lib/store";

export function LiveToggle() {
  const { autoRefresh, toggleRefresh } = useMonitorStore();

  return (
    <Group gap="xs">
      <Text size="sm">Live</Text>
      <Badge color={autoRefresh ? "green" : "gray"}>{autoRefresh ? "ON" : "OFF"}</Badge>
      <ActionIcon variant="light" onClick={toggleRefresh} aria-label="toggle refresh">
        <IconRefresh size={16} />
      </ActionIcon>
    </Group>
  );
}
