import { Box, ScrollArea, Stack, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";
import { buildQuery, fetchJson } from "@/lib/api";
import { Pager } from "@/components/pager";
import { UniverseEditor } from "@/components/universe-editor";

type UniverseEntry = {
  id: string;
  symbol: string;
  name: string | null;
  marketCap: number | null;
  marketCode: string | null;
  marketName: string | null;
};

type UniverseRevision = {
  id: string;
  source: string;
  entryCount: number;
  note: string | null;
  createdAt: string;
};

export default async function UniversePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? "50"));

  const data = await fetchJson<{ items: UniverseEntry[]; total: number }>(
    `/api/universe${buildQuery(page, pageSize)}`,
  );
  const revisions = await fetchJson<{ items: UniverseRevision[]; total: number }>(
    `/api/universe/revisions?page=1&pageSize=20`,
  );

  return (
    <Stack h="100%" gap="md">
      <Title order={3} mb="md">
        Universe
      </Title>

      <UniverseEditor entries={data.items} />

      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea h="100%">
          <Table striped highlightOnHover>
            <TableThead>
              <TableTr>
                <TableTh>Symbol</TableTh>
                <TableTh>Name</TableTh>
                <TableTh>Market Cap</TableTh>
                <TableTh>Market</TableTh>
              </TableTr>
            </TableThead>
            <TableTbody>
              {data.items.map((item) => (
                <TableTr key={item.id}>
                  <TableTd>{item.symbol}</TableTd>
                  <TableTd>{item.name ?? "-"}</TableTd>
                  <TableTd>{item.marketCap ? item.marketCap.toLocaleString() : "-"}</TableTd>
                  <TableTd>{item.marketName ?? item.marketCode ?? "-"}</TableTd>
                </TableTr>
              ))}
            </TableTbody>
          </Table>
        </ScrollArea>
      </Box>

      <Pager totalItems={data.total} />

      <Stack gap="xs" mt="md">
        <Text size="sm" fw={600}>
          Change History
        </Text>
        <Table striped highlightOnHover>
          <TableThead>
            <TableTr>
              <TableTh>Timestamp</TableTh>
              <TableTh>Source</TableTh>
              <TableTh>Entry Count</TableTh>
              <TableTh>Note</TableTh>
            </TableTr>
          </TableThead>
          <TableTbody>
            {revisions.items.map((item) => (
              <TableTr key={item.id}>
                <TableTd>
                  <Text size="xs">{new Date(item.createdAt).toLocaleString()}</Text>
                </TableTd>
                <TableTd>{item.source}</TableTd>
                <TableTd>{item.entryCount}</TableTd>
                <TableTd>{item.note ?? "-"}</TableTd>
              </TableTr>
            ))}
          </TableTbody>
        </Table>
      </Stack>
    </Stack>
  );
}
