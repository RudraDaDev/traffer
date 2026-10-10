export interface BalanceRow {
  /** starting funds */
  budget: number;
  /** commuters to deliver */
  deliver: number;
  /** 2-star spend ceiling */
  parCost: number;
  /** 3-star average commute ceiling, seconds */
  parCommute: number;
}
