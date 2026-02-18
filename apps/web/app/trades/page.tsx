import {
  Badge,
  Box,
  NumberFormatter,
  ScrollArea,
  Stack,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { buildQuery, fetchJson } from "@/lib/api";
import { formatSymbolLabel } from "@/lib/symbols";
import { Pager } from "@/components/pager";

type TradeLog = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  totalAmount: number;
  realizedPnl: number | null;
  mode: string;
  reason: string | null;
  createdAt: string;
};

export default async function TradesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const data = await fetchJson<{ items: TradeLog[]; total: number }>(`/api/monitoring/trades${buildQuery(page, pageSize)}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        Trade Logs
      </Title>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
              <TableTr>
                <TableTh>Timestamp</TableTh>
                <TableTh>Symbol</TableTh>
                <TableTh>Side</TableTh>
                <TableTh>Qty</TableTh>
                <TableTh>Total</TableTh>
                <TableTh>Realized PnL</TableTh>
                <TableTh>Mode</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {data.items.map((item) => (
                <TableTr key={item.id}>
                  <TableTd>
                    <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
                  </TableTd>
                  <TableTd>{formatSymbolLabel(item.symbol)}</TableTd>
                  <TableTd>
                    <Badge color={item.side === "BUY" ? "blue" : "orange"}>{item.side}</Badge>
                  </TableTd>
                  <TableTd>{item.quantity}</TableTd>
                  <TableTd>
                    <NumberFormatter value={item.totalAmount} thousandSeparator suffix=" KRW" />
                  </TableTd>
                  <TableTd>
                    <Text c={(item.realizedPnl ?? 0) >= 0 ? "green" : "red"}>
                      <NumberFormatter value={item.realizedPnl ?? 0} thousandSeparator suffix=" KRW" />
                    </Text>
                  </TableTd>
                  <TableTd>{item.mode}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea>
      </Box>
      <Pager totalItems={data.total} />
    </Stack>
  );
}
