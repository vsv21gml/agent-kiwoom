"use client";

import { useEffect, useMemo, useState } from "react";
import { DatePickerInput } from "@mantine/dates";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type RangeValue = [Date | null, Date | null];

const startOfDayIso = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};

const endOfDayIso = (value: Date) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
};

export function TimeRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialValue = useMemo<RangeValue>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return [from ? new Date(from) : null, to ? new Date(to) : null];
  }, [searchParams]);

  const [value, setValue] = useState<RangeValue>(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const applyValue = (next: RangeValue) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next[0] && next[1]) {
      params.set("from", startOfDayIso(next[0]));
      params.set("to", endOfDayIso(next[1]));
    } else {
      params.delete("from");
      params.delete("to");
    }
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <DatePickerInput
      type="range"
      label="Time Range"
      placeholder="Select range"
      value={value}
      onChange={(next) => {
        setValue(next);
        if (next[0] && next[1]) {
          applyValue(next);
        }
        if (!next[0] && !next[1]) {
          applyValue(next);
        }
      }}
      clearable
      w={280}
    />
  );
}
