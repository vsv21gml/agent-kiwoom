const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${backendUrl}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function buildQuery(page: number, pageSize: number) {
  return `?page=${page}&pageSize=${pageSize}`;
}
