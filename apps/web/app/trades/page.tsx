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
import { FilterBar } from "@/components/filters/filter-bar";
import { TimeRangeFilter } from "@/components/filters/time-range-filter";
import { TradeFilters } from "@/components/filters/trade-filters";

type TradeLog = {
  id: string;
  symbol: string;
  name?: string | null;
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

  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.symbol) query.set("symbol", params.symbol);
  if (params.side) query.set("side", params.side);
  const data = await fetchJson<{ items: TradeLog[]; total: number }>(`/api/monitoring/trades?${query.toString()}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        Trade Logs
      </Title>
      <FilterBar>
        <TimeRangeFilter />
        <TradeFilters />
      </FilterBar>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
                <TableTr>
                  <TableTh>Timestamp</TableTh>
                  <TableTh>Symbol</TableTh>
                  <TableTh>Name</TableTh>
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
                  <TableTd>{item.name ?? "-"}</TableTd>
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
