import {
  Anchor,
  Box,
  Group,
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
import { Pager } from "@/components/pager";
import { FilterBar } from "@/components/filters/filter-bar";
import { TimeRangeFilter } from "@/components/filters/time-range-filter";
import { NewsToolbar } from "@/components/news-toolbar";

type NewsLog = {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export default async function NewsLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "20"));

  const query = new URLSearchParams(buildQuery(page, pageSize).replace("?", ""));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const data = await fetchJson<{ items: NewsLog[]; total: number }>(`/api/monitoring/news?${query.toString()}`);

  return (
    <Stack h="100%" gap="md">
      <Group justify="space-between" align="flex-end">
        <Group gap="sm" align="flex-end">
          <Title order={3}>News</Title>
          <Text size="sm" c="dimmed">
            Run news scrape immediately.
          </Text>
        </Group>
        <NewsToolbar />
      </Group>
      <FilterBar>
        <TimeRangeFilter />
      </FilterBar>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
              <TableTr>
                <TableTh>Timestamp</TableTh>
                <TableTh>Source</TableTh>
                <TableTh>Title</TableTh>
                <TableTh>Summary</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {data.items.map((item) => (
                <TableTr key={item.id}>
                  <TableTd>
                    <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
                  </TableTd>
                  <TableTd>{item.source}</TableTd>
                  <TableTd>
                    <Anchor href={item.url} target="_blank" rel="noreferrer">
                      {item.title}
                    </Anchor>
                  </TableTd>
                  <TableTd>
                    <Text size="sm" lineClamp={2}>
                      {item.summary ?? "-"}
                    </Text>
                  </TableTd>
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
