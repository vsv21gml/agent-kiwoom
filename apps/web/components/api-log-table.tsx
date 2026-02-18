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

export type ApiLogItem = {
  id: string;
  provider: string;
  endpoint: string;
  method: string;
  requestBody: unknown;
  responseBody: unknown;
  statusCode: number | null;
  success: boolean;
  createdAt: string;
};

type Props = {
  items: ApiLogItem[];
};

export function ApiLogTable({ items }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  return (
    <>
      <ScrollArea h="100%">
        <Table striped highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Timestamp</TableTh>
              <TableTh>Provider</TableTh>
              <TableTh>Method</TableTh>
              <TableTh>Endpoint</TableTh>
              <TableTh>Status</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {items.map((item) => (
              <TableTr key={item.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(item.id)}>
                <TableTd>
                  <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
                </TableTd>
                <TableTd>{item.provider}</TableTd>
                <TableTd>{item.method}</TableTd>
                <TableTd>
                  <Text size="xs">{item.endpoint}</Text>
                </TableTd>
                <TableTd>
                  <Badge color={item.success ? "green" : "red"}>{item.statusCode ?? "-"}</Badge>
                </TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </ScrollArea>

      <Drawer opened={Boolean(selected)} onClose={() => setSelectedId(null)} title="API Call Detail" position="right" size="lg">
        {selected ? (
          <ScrollArea h="calc(100vh - 140px)">
            <Group mb="sm" gap="md">
              <Text size="sm">Provider: {selected.provider}</Text>
              <Text size="sm">Method: {selected.method}</Text>
              <Badge color={selected.success ? "green" : "red"}>{selected.statusCode ?? "-"}</Badge>
            </Group>

            <Text fw={700} size="sm" mb={6}>
              Request
            </Text>
            <Text component="pre" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify(selected.requestBody ?? {}, null, 2)}
            </Text>

            <Text fw={700} size="sm" mt="md" mb={6}>
              Response
            </Text>
            <Text component="pre" size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {JSON.stringify(selected.responseBody ?? {}, null, 2)}
            </Text>
          </ScrollArea>
        ) : null}
      </Drawer>
    </>
  );
}
