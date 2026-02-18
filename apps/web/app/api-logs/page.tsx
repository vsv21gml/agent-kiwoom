import {
  Box,
  Stack,
  Title,
} from "@mantine/core";
import { buildQuery, fetchJson } from "@/lib/api";
import { Pager } from "@/components/pager";
import { ApiLogTable, type ApiLogItem } from "@/components/api-log-table";
import { FilterBar } from "@/components/filters/filter-bar";
import { TimeRangeFilter } from "@/components/filters/time-range-filter";
import { ApiLogFilters } from "@/components/filters/api-log-filters";

export default async function ApiLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.endpoint) query.set("endpoint", params.endpoint);
  if (params.status) query.set("status", params.status);
  const data = await fetchJson<{ items: ApiLogItem[]; total: number }>(`/api/monitoring/api-calls?${query.toString()}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        API Logs
      </Title>
      <FilterBar>
        <TimeRangeFilter />
        <ApiLogFilters />
      </FilterBar>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ApiLogTable items={data.items} />
      </Box>
      <Pager totalItems={data.total} />
    </Stack>
  );
}
