"use client";

import { useMemo, useState } from "react";
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useRouter } from "next/navigation";

type UniverseEntry = {
  symbol: string;
  name?: string | null;
  marketCap?: number | null;
  marketCode?: string | null;
  marketName?: string | null;
};

type Props = {
  entries: UniverseEntry[];
};

const toCsv = (entries: UniverseEntry[]) => {
  const header = "symbol,name,marketCap,marketCode,marketName";
  const lines = entries.map(
    (entry) =>
      [
        entry.symbol,
        entry.name ?? "",
        entry.marketCap ?? "",
        entry.marketCode ?? "",
        entry.marketName ?? "",
      ].join(","),
  );
  return [header, ...lines].join("\n");
};

const parseCsv = (raw: string): UniverseEntry[] => {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const data = lines[0].toLowerCase().includes("symbol") ? lines.slice(1) : lines;
  return data.map((line) => {
    const [symbol, name, marketCap, marketCode, marketName] = line.split(",").map((v) => v.trim());
    return {
      symbol,
      name: name || null,
      marketCap: marketCap ? Number(marketCap) : null,
      marketCode: marketCode || null,
      marketName: marketName || null,
    };
  }).filter((entry) => entry.symbol);
};

export function UniverseEditor({ entries }: Props) {
  const router = useRouter();
  const initial = useMemo(() => toCsv(entries), [entries]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

  const save = async () => {
    setSaving(true);
    try {
      const payload = parseCsv(value);
      const res = await fetch(`${baseUrl}/api/universe`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: payload }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      setStatus(`Saved ${payload.length} entries.`);
      setEditing(false);
      router.refresh();
    } catch (error) {
      setStatus(`Save failed: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Universe entries (CSV). Edit and save to replace all entries.
        </Text>
        <Group gap="sm">
          <Button variant="light" onClick={() => setEditing((value) => !value)}>
            {editing ? "Close" : "Edit"}
          </Button>
          {editing && (
            <Button onClick={save} loading={saving}>
              Save
            </Button>
          )}
        </Group>
      </Group>
      {status && (
        <Text size="sm" c="dimmed">
          {status}
        </Text>
      )}
      {editing && (
        <Textarea
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          minRows={12}
          autosize
          styles={{ input: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" } }}
        />
      )}
    </Stack>
  );
}
