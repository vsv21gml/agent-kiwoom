import {
  Box,
  Stack,
  Title,
} from "@mantine/core";
import { buildQuery, fetchJson } from "@/lib/api";
import { Pager } from "@/components/pager";
import { ApiLogTable, type ApiLogItem } from "@/components/api-log-table";

export default async function ApiLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const data = await fetchJson<{ items: ApiLogItem[]; total: number }>(`/api/monitoring/api-calls${buildQuery(page, pageSize)}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        API Logs
      </Title>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ApiLogTable items={data.items} />
      </Box>
      <Pager totalItems={data.total} />
    </Stack>
  );
}
