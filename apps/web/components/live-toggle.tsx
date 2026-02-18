"use client";

import { useEffect } from "react";
import { ActionIcon, Badge, Group, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useMonitorStore } from "@/lib/store";

export function LiveToggle() {
  const { autoRefresh, toggleRefresh } = useMonitorStore();
  const router = useRouter();

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
    const source = new EventSource(`${baseUrl}/api/monitoring/stream`);

    const handleEvent = () => {
      router.refresh();
    };

    source.addEventListener("market", handleEvent);
    source.addEventListener("news", handleEvent);
    source.addEventListener("report", handleEvent);
    source.onmessage = handleEvent;

    return () => {
      source.close();
    };
  }, [autoRefresh, router]);

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
