export type TradeSide = "BUY" | "SELL" | "HOLD";

export interface Quote {
  symbol: string;
  price: number;
  changeRate: number;
  volume: number;
  asOf: string;
}

export interface TradeDecision {
  symbol: string;
  side: TradeSide;
  quantity: number;
  reason: string;
  confidence: number;
}
