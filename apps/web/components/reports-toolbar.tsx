"use client";

import { useState } from "react";
import { Button, Group, Text } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

export function ReportsToolbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const runNow = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/reports/run`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Failed to run report: ${res.status}`);
      }
      const data = (await res.json()) as { runId?: string };
      setLastRunId(data.runId ?? null);
      router.refresh();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button leftSection={<IconPlayerPlay size={16} />} loading={loading} onClick={runNow}>
      Run Now
    </Button>
  );
}
