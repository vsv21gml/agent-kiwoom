const SYMBOL_NAME_MAP: Record<string, string> = {
  "005930": "Samsung Electronics",
  "000660": "SK hynix",
  "035420": "NAVER",
};

export function formatSymbolLabel(symbol: string): string {
  const name = SYMBOL_NAME_MAP[symbol];
  return name ? `${name} (${symbol})` : symbol;
}
