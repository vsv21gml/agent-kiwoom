"use client";

import { useEffect, useState } from "react";
import { Button, Group, Stack, Textarea, Text } from "@mantine/core";

type StrategyResponse = { content: string };

export function StrategyEditor() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/strategy`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = (await res.json()) as StrategyResponse;
      setContent(data.content ?? "");
      setStatus(null);
    } catch (error) {
      setStatus(`Load failed: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/strategy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setStatus("Saved.");
    } catch (error) {
      setStatus(`Save failed: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Stack h="auto" gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Edit strategy markdown stored in DB.
        </Text>
        <Group gap="sm">
          <Button variant="light" onClick={load} loading={loading}>
            Reload
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </Group>
      </Group>
      {status && (
        <Text size="sm" c="dimmed">
          {status}
        </Text>
      )}
      <Textarea
        value={content}
        onChange={(event) => setContent(event.currentTarget.value)}
        minRows={10}
        maxRows={20}
        autosize
        styles={{ input: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" } }}
      />
    </Stack>
  );
}
