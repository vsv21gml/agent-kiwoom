"use client";

import { useMemo, useState } from "react";
import { Box, Drawer, Group, ScrollArea, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";

type StrategyRevision = {
  id: string;
  source: string;
  createdAt: string;
};

type RevisionPayload = {
  id: string;
  content: string;
  createdAt: string;
};

type DiffLine = { type: "add" | "del" | "context"; text: string };

const diffLines = (oldText: string, newText: string): DiffLine[] => {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: "context", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      lines.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    lines.push({ type: "add", text: b[j] });
    j += 1;
  }
  return lines;
};

export function StrategyRevisions({ items }: { items: StrategyRevision[] }) {
  const [opened, setOpened] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(false);

  const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
  const indexMap = useMemo(() => new Map(items.map((item, idx) => [item.id, idx])), [items]);

  const openRevision = async (id: string) => {
    setOpened(true);
    setActiveId(id);
    setLoading(true);
    try {
      const idx = indexMap.get(id) ?? 0;
      const current = await fetch(`${baseUrl}/api/strategy/revisions/${id}`).then((res) => res.json() as Promise<RevisionPayload>);
      const previousId = items[idx + 1]?.id;
      let previousContent = "";
      if (previousId) {
        const prev = await fetch(`${baseUrl}/api/strategy/revisions/${previousId}`).then((res) => res.json() as Promise<RevisionPayload>);
        previousContent = prev?.content ?? "";
      }
      const lines = diffLines(previousContent, current?.content ?? "");
      setDiff(lines);
    } catch {
      setDiff([{ type: "context", text: "Failed to load diff." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Table striped highlightOnHover>
        <TableThead>
          <TableTr>
            <TableTh>Timestamp</TableTh>
            <TableTh>Source</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {items.map((item) => (
            <TableTr key={item.id} onClick={() => openRevision(item.id)} style={{ cursor: "pointer" }}>
              <TableTd>
                <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
              </TableTd>
              <TableTd>{item.source}</TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>

      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title="Strategy Diff"
        position="right"
        size="xl"
      >
        {loading ? (
          <Text size="sm">Loading...</Text>
        ) : (
          <ScrollArea h="calc(100vh - 140px)">
            <Box component="pre" style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
              {diff.map((line, idx) => {
                const color = line.type === "add" ? "#1b7f2a" : line.type === "del" ? "#b42318" : "#6c757d";
                const prefix = line.type === "add" ? "+ " : line.type === "del" ? "- " : "  ";
                return (
                  <Text key={`${idx}-${line.type}`} span style={{ color, display: "block" }}>
                    {prefix}
                    {line.text}
                  </Text>
                );
              })}
            </Box>
          </ScrollArea>
        )}
      </Drawer>
    </>
  );
}
