"use client";

import { useMemo, useState } from "react";
import { Badge, Drawer, NumberFormatter, ScrollArea, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";

type ReportItem = {
  id: string;
  runId: string;
  totalAsset: number;
  holdingsValue: number;
  cash: number;
  assetDelta: number;
  buyCount: number;
  sellCount: number;
  tradeCount: number;
  decisionCount: number;
  universeSize: number;
  reportText: string;
  createdAt: string;
};

export function ReportsTable({ items }: { items: ReportItem[] }) {
  const [opened, setOpened] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(() => items.find((item) => item.id === activeId) ?? null, [activeId, items]);

  const open = (id: string) => {
    setActiveId(id);
    setOpened(true);
  };

  return (
    <>
      <Table striped highlightOnHover>
        <TableThead>
          <TableTr>
            <TableTh>Timestamp</TableTh>
            <TableTh>Total Asset</TableTh>
            <TableTh>Asset Delta</TableTh>
            <TableTh>Buys</TableTh>
            <TableTh>Sells</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {items.map((item) => (
            <TableTr key={item.id} onClick={() => open(item.id)} style={{ cursor: "pointer" }}>
              <TableTd>
                <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
              </TableTd>
              <TableTd>
                <NumberFormatter value={item.totalAsset} thousandSeparator suffix=" KRW" />
              </TableTd>
              <TableTd>
                <NumberFormatter
                  value={item.assetDelta}
                  thousandSeparator
                  suffix=" KRW"
                  prefix={item.assetDelta > 0 ? "+" : ""}
                />
              </TableTd>
              <TableTd>
                <Badge color="blue">{item.buyCount}</Badge>
              </TableTd>
              <TableTd>
                <Badge color="orange">{item.sellCount}</Badge>
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>

      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title={active ? `Report ${new Date(active.createdAt).toLocaleString()}` : "Report"}
        position="right"
        size="xl"
      >
        {active ? (
          <ScrollArea h="calc(100vh - 140px)">
            <Text size="sm" component="pre" style={{ whiteSpace: "pre-wrap" }}>
              {active.reportText}
            </Text>
          </ScrollArea>
        ) : (
          <Text size="sm">No report selected.</Text>
        )}
      </Drawer>
    </>
  );
}
