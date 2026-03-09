"use client";

import { useState } from "react";
import { Button, Group, Text } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

export function NewsToolbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const runNow = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/news/run`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Failed to run news: ${res.status}`);
      }
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
