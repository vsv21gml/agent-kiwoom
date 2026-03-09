"use client";

import { useState } from "react";
import { Button } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

export function TradesToolbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const refreshStatuses = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/trades/refresh-status`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Failed to refresh trade statuses: ${res.status}`);
      }
      router.refresh();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button leftSection={<IconRefresh size={16} />} loading={loading} onClick={refreshStatuses} variant="light">
      체결상태 최신화
    </Button>
  );
}
