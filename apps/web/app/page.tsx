import {
  Badge,
  Box,
  Card,
  Group,
  NumberFormatter,
  ScrollArea,
  SimpleGrid,
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
    virtualMode: boolean;
    holdings: Holding[];
  };
};

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const data = await fetchJson<AssetResponse>(`/api/monitoring/assets${buildQuery(page, pageSize)}`);

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

      <SimpleGrid cols={{ base: 1, md: 3 }} mb="md">
        <Card withBorder radius="md" p="lg" style={{ background: "var(--app-surface)" }}>
          <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
            Mode
          </Text>
          <Group mt="sm">
            <Badge size="lg" color={data.summary.virtualMode ? "blue" : "grape"} variant="light">
              {data.summary.virtualMode ? "VIRTUAL" : "REAL"}
            </Badge>
          </Group>
        </Card>

        <Card withBorder radius="md" p="lg" style={{ background: "var(--app-surface)" }}>
          <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
            Initial Capital
          </Text>
          <Text mt="sm" fw={700} size="xl">
            <NumberFormatter value={data.summary.initialCapital} thousandSeparator suffix=" KRW" />
          </Text>
        </Card>

        <Card withBorder radius="md" p="lg" style={{ background: "var(--app-surface)" }}>
          <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
            Cash
          </Text>
          <Text mt="sm" fw={700} size="xl" c="teal.7">
            <NumberFormatter value={data.summary.cash} thousandSeparator suffix=" KRW" />
          </Text>
        </Card>
      </SimpleGrid>

      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
              <TableTr>
                <TableTh>Symbol</TableTh>
                <TableTh>Quantity</TableTh>
                <TableTh>Avg Price</TableTh>
                <TableTh>Current Value</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {data.summary.holdings.map((holding) => (
                <TableTr key={holding.id}>
                  <TableTd>{formatSymbolLabel(holding.symbol)}</TableTd>
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
