"use client";

import { Group, Pagination, Select } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function Pager({ totalItems }: { totalItems: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "20");
  const pages = Math.max(1, Math.ceil(totalItems / pageSize));

  const push = (nextPage: number, nextPageSize: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <Group justify="space-between" mt="md">
      <Select
        value={String(pageSize)}
        data={["10", "20", "50"]}
        w={120}
        onChange={(value) => push(1, Number(value ?? "20"))}
      />
      <Pagination value={page} total={pages} onChange={(next) => push(next, pageSize)} />
    </Group>
  );
}
