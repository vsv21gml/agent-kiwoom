import {
  Anchor,
  Box,
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

  const data = await fetchJson<{ items: NewsLog[]; total: number }>(`/api/monitoring/news${buildQuery(page, pageSize)}`);

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        News Logs
      </Title>
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
