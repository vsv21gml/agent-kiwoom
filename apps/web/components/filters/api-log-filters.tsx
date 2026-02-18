"use client";

import { Select, TextInput } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const statusOptions = [
  { value: "", label: "All" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
];

export function ApiLogFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const applyParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value.length > 0) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <>
      <TextInput
        label="Endpoint"
        placeholder="/api/dostk/stkinfo"
        defaultValue={searchParams.get("endpoint") ?? ""}
        onBlur={(event) => applyParam("endpoint", event.currentTarget.value.trim())}
        w={260}
      />
      <Select
        label="Status"
        data={statusOptions}
        value={searchParams.get("status") ?? ""}
        onChange={(value) => applyParam("status", value)}
        w={160}
      />
    </>
  );
}
