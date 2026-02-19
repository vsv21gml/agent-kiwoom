import {
  Box,
  Card,
  Group,
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
import { LineChart } from "@mantine/charts";
import { buildQuery, fetchJson } from "@/lib/api";
import { formatSymbolLabel } from "@/lib/symbols";
import { Pager } from "@/components/pager";
import { FilterBar } from "@/components/filters/filter-bar";
import { TimeRangeFilter } from "@/components/filters/time-range-filter";

type Snapshot = {
  id: string;
  cash: number;
  holdingsValue: number;
  totalAsset: number;
  createdAt: string;
};

type Holding = {
  id: string;
  symbol: string;
  name?: string | null;
  quantity: number;
  avgPrice: number;
};

type AssetResponse = {
  timeline: {
    items: Snapshot[];
    total: number;
  };
  summary: {
    cash: number;
    initialCapital: number;
    holdings: Holding[];
  };
};

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const data = await fetchJson<AssetResponse>(`/api/monitoring/assets?${query.toString()}`);

  const chartData = [...data.timeline.items].reverse().map((item) => ({
    time: new Date(item.createdAt).toLocaleString(),
    totalAsset: item.totalAsset,
    cash: item.cash,
    holdings: item.holdingsValue,
  }));

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        Asset Monitoring
      </Title>
      <FilterBar>
        <TimeRangeFilter />
      </FilterBar>
      <Card withBorder radius="md" mb="md" style={{ background: "var(--app-surface)" }}>
        <LineChart
          h={220}
          data={chartData}
          dataKey="time"
          series={[
            { name: "totalAsset", color: "teal.6", label: "Total Asset" },
            { name: "cash", color: "blue.6", label: "Cash" },
            { name: "holdings", color: "orange.6", label: "Holdings" },
          ]}
          curveType="natural"
        />
      </Card>

      <Card withBorder radius="md" p="lg" mb="md" style={{ background: "var(--app-surface)" }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
              Initial Capital
            </Text>
            <Text fw={700} size="lg">
              <NumberFormatter value={data.summary.initialCapital} thousandSeparator suffix=" KRW" />
            </Text>
          </Group>

          <Group gap="sm" wrap="nowrap">
            <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
              Cash
            </Text>
            <Text fw={700} size="lg" c="teal.7">
              <NumberFormatter value={data.summary.cash} thousandSeparator suffix=" KRW" />
            </Text>
          </Group>
        </Group>
      </Card>

      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
              <TableTr>
                <TableTh>Symbol</TableTh>
                <TableTh>Name</TableTh>
                <TableTh>Quantity</TableTh>
                <TableTh>Avg Price</TableTh>
                <TableTh>Current Value</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {data.summary.holdings.map((holding) => (
                <TableTr key={holding.id}>
                  <TableTd>{formatSymbolLabel(holding.symbol)}</TableTd>
                  <TableTd>{holding.name ?? "-"}</TableTd>
                  <TableTd>{holding.quantity}</TableTd>
                  <TableTd>
                    <NumberFormatter value={holding.avgPrice} thousandSeparator suffix=" KRW" />
                  </TableTd>
                  <TableTd>
                    <NumberFormatter value={holding.avgPrice * holding.quantity} thousandSeparator suffix=" KRW" />
                  </TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea>
      </Box>

      <Pager totalItems={data.timeline.total} />
    </Stack>
  );
}
