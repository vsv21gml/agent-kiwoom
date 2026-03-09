"use client";

import { useState } from "react";
import { Button } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

export function AssetsToolbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const refreshQuotes = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/assets/refresh-quotes`, { method: "POST" });
      if (!res.ok) {
        throw new Error(`Failed to refresh holding quotes: ${res.status}`);
      }
      router.refresh();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button leftSection={<IconRefresh size={16} />} loading={loading} onClick={refreshQuotes} variant="light">
      종목별 시세 최신화
    </Button>
  );
}
