"use client";

import { Select, TextInput } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const sideOptions = [
  { value: "", label: "All" },
  { value: "BUY", label: "BUY" },
  { value: "SELL", label: "SELL" },
];

const statusOptions = [
  { value: "", label: "All" },
  { value: "ORDER_REQUESTED", label: "ORDER_REQUESTED" },
  { value: "EXECUTED", label: "EXECUTED" },
  { value: "PARTIALLY_FILLED", label: "PARTIALLY_FILLED" },
  { value: "NOT_FILLED", label: "NOT_FILLED" },
];

export function TradeFilters() {
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
      <Select
        label="Side"
        data={sideOptions}
        value={searchParams.get("side") ?? ""}
        onChange={(value) => applyParam("side", value)}
        w={160}
      />
      <TextInput
        label="Symbol"
        placeholder="005930"
        defaultValue={searchParams.get("symbol") ?? ""}
        onBlur={(event) => applyParam("symbol", event.currentTarget.value.trim())}
        w={200}
      />
      <Select
        label="Status"
        data={statusOptions}
        value={searchParams.get("status") ?? ""}
        onChange={(value) => applyParam("status", value)}
        w={220}
      />
    </>
  );
}
