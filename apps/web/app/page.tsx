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
import { AssetsToolbar } from "@/components/assets-toolbar";

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
  currentPrice?: number | null;
  currentValue?: number;
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

type AccountHolding = {
  symbol: string;
  name?: string | null;
  quantity: number;
  avgPrice: number;
  price: number;
  marketValue: number;
  unrealizedPnl: number;
  profitRate: number;
};

type AccountSummary = {
  cash: number;
  totalAsset: number;
  holdingsValue: number;
  holdings: AccountHolding[];
  mode?: string;
};

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const [data, account] = await Promise.all([
    fetchJson<AssetResponse>(`/api/monitoring/assets?${query.toString()}`),
    fetchJson<AccountSummary>("/api/kiwoom/account"),
  ]);

  const chartData = [...data.timeline.items].reverse().map((item) => ({
    time: new Date(item.createdAt).toLocaleString(),
    totalAsset: item.totalAsset,
    cash: item.cash,
    holdings: item.holdingsValue,
  }));
  const holdingsAsset = data.summary.holdings.reduce(
    (sum, holding) => sum + (holding.currentValue ?? holding.avgPrice * holding.quantity),
    0,
  );
  const totalAsset = data.summary.cash + holdingsAsset;
  const accountBySymbol = new Map(account.holdings.map((holding) => [holding.symbol, holding]));

  return (
    <Stack h="100%" gap="md">
      <Group justify="space-between" align="center">
        <Title order={3} mb="md">
          Asset Monitoring
        </Title>
        <AssetsToolbar />
      </Group>
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
              Cash
            </Text>
            <Text fw={700} size="lg" c="teal.7">
              <NumberFormatter value={data.summary.cash} thousandSeparator suffix=" KRW" />
            </Text>
          </Group>

          <Group gap="sm" wrap="nowrap">
            <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
              Holdings Asset
            </Text>
            <Text fw={700} size="lg">
              <NumberFormatter value={holdingsAsset} thousandSeparator suffix=" KRW" />
            </Text>
          </Group>

          <Group gap="sm" wrap="nowrap">
            <Text c="dimmed" size="xs" tt="uppercase" fw={700}>
              Total Asset
            </Text>
            <Text fw={700} size="lg" c="blue.7">
              <NumberFormatter value={totalAsset} thousandSeparator suffix=" KRW" />
            </Text>
          </Group>
        </Group>
      </Card>

      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
              <TableTr>
                <TableTh>Name</TableTh>
                <TableTh>Quantity</TableTh>
                <TableTh>Avg Price</TableTh>
                <TableTh>Current Quote</TableTh>
                <TableTh>PnL</TableTh>
                <TableTh>PnL %</TableTh>
                <TableTh>Current Value</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {data.summary.holdings.map((holding) => {
                const accountHolding = accountBySymbol.get(holding.symbol);
                const pnl = accountHolding?.unrealizedPnl;
                const pnlRate = accountHolding?.profitRate;
                const pnlColor =
                  pnl == null ? undefined : pnl > 0 ? "teal.7" : pnl < 0 ? "red.7" : "dimmed";

                return (
                  <TableTr key={holding.id}>
                    <TableTd>{holding.name ?? accountHolding?.name ?? "-"}</TableTd>
                    <TableTd>{holding.quantity}</TableTd>
                    <TableTd>
                      <NumberFormatter value={holding.avgPrice} thousandSeparator suffix=" KRW" />
                    </TableTd>
                    <TableTd>
                      {holding.currentPrice != null ? (
                        <NumberFormatter value={holding.currentPrice} thousandSeparator suffix=" KRW" />
                      ) : accountHolding ? (
                        <NumberFormatter value={accountHolding.price} thousandSeparator suffix=" KRW" />
                      ) : (
                        "-"
                      )}
                    </TableTd>
                    <TableTd>
                      {pnl != null ? (
                        <Text c={pnlColor} fw={700}>
                          <NumberFormatter value={pnl} thousandSeparator suffix=" KRW" />
                        </Text>
                      ) : (
                        "-"
                      )}
                    </TableTd>
                    <TableTd>
                      {pnlRate != null ? (
                        <Text c={pnlColor} fw={700}>
                          <NumberFormatter value={pnlRate} decimalScale={2} fixedDecimalScale suffix=" %" />
                        </Text>
                      ) : (
                        "-"
                      )}
                    </TableTd>
                    <TableTd>
                      <NumberFormatter
                        value={holding.currentValue ?? holding.avgPrice * holding.quantity}
                        thousandSeparator
                        suffix=" KRW"
                      />
                    </TableTd>
                  </TableTr>
                );
              })}
            </TableTbody>
          </Table>
        </ScrollArea>
      </Box>

      <Pager totalItems={data.timeline.total} />
    </Stack>
  );
}
