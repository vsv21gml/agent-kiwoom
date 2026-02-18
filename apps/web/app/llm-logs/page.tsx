import { Box, Stack, Title } from "@mantine/core";
import { Pager } from "@/components/pager";
import { LlmLogTable, type LlmLogItem } from "@/components/llm-log-table";
import { buildQuery, fetchJson } from "@/lib/api";

export default async function LlmLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));
  const data = await fetchJson<{ items: LlmLogItem[]; total: number }>(`/api/monitoring/llm-calls${buildQuery(page, pageSize)}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        LLM Logs
      </Title>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <LlmLogTable items={data.items} />
      </Box>
      <Pager totalItems={data.total} />
    </Stack>
  );
}
