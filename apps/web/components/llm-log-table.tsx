"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Drawer,
  Group,
  ScrollArea,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";

export type LlmLogItem = {
  id: string;
  model: string;
  inputText: string;
  outputText: string | null;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
  createdAt: string;
};

type Props = {
  items: LlmLogItem[];
};

export function LlmLogTable({ items }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  return (
    <>
      <ScrollArea h="100%">
        <Table striped highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Timestamp</TableTh>
              <TableTh>Model</TableTh>
              <TableTh>Status</TableTh>
              <TableTh>Input Tokens</TableTh>
              <TableTh>Output Tokens</TableTh>
              <TableTh>Total Tokens</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {items.map((item) => (
              <TableTr key={item.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(item.id)}>
                <TableTd>
                  <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
                </TableTd>
                <TableTd>{item.model}</TableTd>
                <TableTd>
                  <Badge color={item.success ? "green" : "red"}>{item.statusCode ?? "-"}</Badge>
                </TableTd>
                <TableTd>{item.promptTokenCount ?? "-"}</TableTd>
                <TableTd>{item.candidatesTokenCount ?? "-"}</TableTd>
                <TableTd>{item.totalTokenCount ?? "-"}</TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </ScrollArea>

      <Drawer
        opened={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title="LLM Call Detail"
        position="right"
        size="lg"
      >
        {selected ? (
          <ScrollArea h="calc(100vh - 140px)">
            <Group mb="sm" gap="md">
              <Text size="sm">Model: {selected.model}</Text>
              <Badge color={selected.success ? "green" : "red"}>{selected.statusCode ?? "-"}</Badge>
            </Group>

            <Text fw={700} size="sm" mb={6}>
              API Request
            </Text>
            <Text component="pre" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {selected.inputText}
            </Text>

            <Text fw={700} size="sm" mt="md" mb={6}>
              API Response
            </Text>
            <Text component="pre" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {selected.outputText ?? selected.errorMessage ?? "-"}
            </Text>

            <Text fw={700} size="sm" mt="md" mb={6}>
              Token Usage
            </Text>
            <Text size="sm">Input: {selected.promptTokenCount ?? "-"}</Text>
            <Text size="sm">Output: {selected.candidatesTokenCount ?? "-"}</Text>
            <Text size="sm">Total: {selected.totalTokenCount ?? "-"}</Text>
          </ScrollArea>
        ) : null}
      </Drawer>
    </>
  );
}
