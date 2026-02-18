import { Box, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { buildQuery, fetchJson } from "@/lib/api";
import { Pager } from "@/components/pager";
import { ReportsTable } from "@/components/reports-table";
import { ReportsToolbar } from "@/components/reports-toolbar";
import { FilterBar } from "@/components/filters/filter-bar";
import { TimeRangeFilter } from "@/components/filters/time-range-filter";

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

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const data = await fetchJson<{ items: ReportItem[]; total: number }>(
    `/api/monitoring/reports?${query.toString()}`,
  );

  return (
    <Stack h="100%" gap="md" style={{ minHeight: 0 }}>
      <Group justify="space-between" align="flex-end">
        <Group gap="sm" align="flex-end">
          <Title order={3}>Reports</Title>
          <Text size="sm" c="dimmed">
            {`Run the market cycle to generate a report.`}
          </Text>
        </Group>
        <ReportsToolbar />
      </Group>
      <FilterBar>
        <TimeRangeFilter />
      </FilterBar>
      <Box style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <ScrollArea h="100%">
          <ReportsTable items={data.items} />
        </ScrollArea>
      </Box>
      <Pager totalItems={data.total} />
    </Stack>
  );
}
