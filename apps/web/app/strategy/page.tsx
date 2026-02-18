import { Box, Stack, Text, Title } from "@mantine/core";
import { StrategyEditor } from "@/components/strategy-editor";
import { StrategyRevisions } from "@/components/strategy-revisions";
import { fetchJson } from "@/lib/api";

type StrategyRevision = {
  id: string;
  source: string;
  createdAt: string;
};

export default async function StrategyPage() {
  const revisions = await fetchJson<{ items: StrategyRevision[]; total: number }>(
    "/api/strategy/revisions?page=1&pageSize=20",
  );
  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        Strategy
      </Title>
      <StrategyEditor />
      <Box>
        <Text size="sm" fw={600} mb="xs">
          Change History
        </Text>
        <StrategyRevisions items={revisions.items} />
      </Box>
    </Stack>
  );
}
