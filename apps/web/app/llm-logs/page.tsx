import { Box, Stack, Title } from "@mantine/core";
import { Pager } from "@/components/pager";
import { LlmLogTable, type LlmLogItem } from "@/components/llm-log-table";
import { buildQuery, fetchJson } from "@/lib/api";
import { FilterBar } from "@/components/filters/filter-bar";
import { TimeRangeFilter } from "@/components/filters/time-range-filter";
import { LlmFilters } from "@/components/filters/llm-filters";

export default async function LlmLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));
  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.model) query.set("model", params.model);
  if (params.status) query.set("status", params.status);
  const data = await fetchJson<{ items: LlmLogItem[]; total: number }>(`/api/monitoring/llm-calls?${query.toString()}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        LLM Logs
      </Title>
      <FilterBar>
        <TimeRangeFilter />
        <LlmFilters />
      </FilterBar>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <LlmLogTable items={data.items} />
      </Box>
      <Pager totalItems={data.total} />
    </Stack>
  );
}
