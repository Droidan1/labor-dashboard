// How to read the reporting API's numbers, condensed from its handover doc
// (GSD/worker/API_HANDOVER.md §2). Every rule is a way to read a correct
// figure wrongly, so every agent surface carries them.
//
// 🔑 This is the canonical copy. cli/retjg.mjs repeats them in its --help,
// because the CLI is installed as one copied file and cannot import this one;
// scripts/test-retjg-mcp.mjs fails if the two drift apart.
export const READING_RULES = [
  'Money is plain USD. Percentages and margins are fractions: 0.43 = 43%.',
  'null means unknown, never zero. reportingStatus "no_data" = the figure is unverified, not an outage. "closed" = a real 0 (Holland, BL8, closed for good 2026-07-25).',
  'netSales = posSales (the till) + auctionSales (live sales: online auction + Whatnot).',
  'Compare lySalesForDate with posSales, never netSales: last year has no live sales.',
  'Do not compare or trend DAILY grossMargin. Bin prices fall through the week while bin cost is flat, so a store swings ~27% to ~67% in a normal week. Use wtdGrossMargin. A negative bin or category margin late in the week is expected, not a problem.',
  'grossMargin is null when costCoverage < 0.90. In history it is always null.',
  'Check wtdDaysReported / mtdDaysReported before using a WTD or MTD figure.',
  'laborActualPct is worked hours x a flat rate / sales, not payroll.',
  'today: salesSoFarToday is till only but todayBudget includes live sales, so stores with live sales read ~2-4% light on pace.',
];
