export type Side = "BUY" | "SELL" | "HOLD";

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AssetPoint {
  timestamp: string;
  totalAsset: number;
  cash: number;
  holdingsValue: number;
}
