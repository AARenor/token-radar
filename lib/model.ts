// One sealed snapshot in, a ranked board and an offline dashboard dataset out.
//
// Calibration uses every protocol with a recorded market cap and positive TVL. Its ratio is market
// cap / TVL. Percentiles use linear interpolation at (sample count - 1) * percentile. Each exact
// snapshot category with at least 3 live comparables gets (n * category median + 8 * global median)
// / (n + 8); smaller or absent categories use the global median. Missing categories are "Other".
// The category risk table is subjective: Lending 1.0, DEX 1.05, Yield 0.9, Perp 0.8, CDP 0.85,
// Liquid Staking-adjacent 0.9, Bridge-adjacent 0.7, Restaking 0.75, RWA 0.8 and Other 0.85.
// The table below gives the reason for each adjustment and never names individual protocols.
//
// Growth defaults to 0%, is clamped to -60%..120%, and contributes 0.5 of that change. Maturity is
// 0.6 + min(age, 1095) / 1095 * 0.4; an unknown age uses 365 days. The rounded product of TVL,
// applied ratio, growth, maturity and category risk is clamped to $1..$100,000,000,000,000.
// The board includes every watchlist slug and up to 280 eligible pre-token protocols below the floor,
// selected by TVL. Early candidates exclude CEX, versioned pools, and named wrapped or staking products.
// The separate live view holds up to 24 market-cap-ranked protocols, excluding CEX.
// Farm amounts of $25 or $10 and times of 5 to 15 minutes are illustrative, not observed fees or
// eligibility claims. Network and product fees vary, and no reward is guaranteed.

/** One protocol in the sealed snapshot. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The global base is filled from the snapshot, not a fixed model assumption. */
export interface ModelConstants {
  base_multiple: number | null;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: null,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 280;
export const LIVE_ROWS = 24;

export type Sector =
  | 'Lending'
  | 'DEX'
  | 'Yield'
  | 'Perp'
  | 'CDP'
  | 'Liquid Staking-adjacent'
  | 'Bridge-adjacent'
  | 'Restaking'
  | 'RWA'
  | 'Other';

/** Subjective adjustments for product risk, not estimates learned from market caps. */
export const RISK_MULTIPLIERS: Record<Sector, number> = {
  Lending: 1.0, // Liquidation and collateral risks sit at the neutral reference.
  DEX: 1.05, // Trading fees can accrue without the same collateral exposure.
  Yield: 0.9, // Automated strategies add contract and strategy dependencies.
  Perp: 0.8, // Leverage and liquidation amplify trading losses.
  CDP: 0.85, // Collateral and stablecoin peg failures can cascade.
  'Liquid Staking-adjacent': 0.9, // Validator failures and withdrawal queues add risk.
  'Bridge-adjacent': 0.7, // Cross-chain custody and messaging add attack surfaces.
  Restaking: 0.75, // Shared security layers can stack slashing and contract risks.
  RWA: 0.8, // Off-chain custody, legal rights and redemption add dependencies.
  Other: 0.85, // Mixed products receive a conservative adjustment for unknown risks.
};

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface ValueDetails {
  base_multiple: number;
  sector_multiple: number;
  sector_samples: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  risk_multiplier: number;
  tvl_usd: number;
}

export interface BoardRow extends SnapshotProtocol {
  rank: number;
  token_status: 'pre-token';
  sector: Sector;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ValueDetails;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  sector: Sector;
  on_watchlist: boolean;
  farm_steps: FarmStep[];
  value: ValueDetails;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl_ratio: number;
}

export interface CategoryStats {
  category: string;
  live_count: number;
  median_ratio: number | null;
  p25_ratio: number | null;
  p75_ratio: number | null;
  applied_ratio: number;
  risk_multiplier: number;
}

export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

export interface RadarData extends BoardSummary {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryStats[];
  stats: {
    median_implied_usd: number;
    total_implied_usd: number;
    watchlist_rows: number;
    early_rows: number;
  };
  model_notes: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const SHRINKAGE = 8;
const MIN_CATEGORY_SAMPLES = 3;
const MAX_VALUE_USD = 100_000_000_000_000;
const VERSIONED = /\s(?:[vV]\d+(?:\.\d+)?|\d+\.\d+)$/;
const WRAPPED_PRODUCT = /\b(?:wrapped|staked|staking)\b/i;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole elapsed UTC days, or null when a date is absent or invalid. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The original snapshot categories remain separate for comparable calculations. */
function categoryOf(category: string | null): string {
  return category === null || category.trim() === '' ? 'Other' : category;
}

/** Assign a product-risk sector without naming any protocol. */
function sectorOf(category: string | null): Sector {
  const c = categoryOf(category).toLowerCase();
  if (c.includes('restak')) return 'Restaking';
  if (c.includes('bridge')) return 'Bridge-adjacent';
  if (c.includes('staking')) return 'Liquid Staking-adjacent';
  if (c.includes('rwa')) return 'RWA';
  if (c.includes('cdp') || c === 'algo-stables' || c === 'dual-token stablecoin' || c === 'stablecoin issuer') return 'CDP';
  if (c.includes('lend') || c === 'collateral markets') return 'Lending';
  if (c.includes('dex')) return 'DEX';
  if (c.includes('yield') || c.includes('farm') || c === 'onchain capital allocator' || c === 'risk curators') return 'Yield';
  if (c.includes('perp') || c === 'derivatives' || c === 'basis trading') return 'Perp';
  return 'Other';
}

/** Linear percentile of a nonempty, already sorted sample. */
function percentile(sorted: number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

interface Calibration {
  globalMedian: number;
  categories: CategoryStats[];
  byCategory: Map<string, CategoryStats>;
}

/** Collect all live-token ratios once, then shrink each exact category toward the global median. */
function calibrate(snapshot: Snapshot): Calibration {
  const grouped = new Map<string, number[]>();
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    const category = categoryOf(p.category);
    let sample = grouped.get(category);
    if (sample === undefined) {
      sample = [];
      grouped.set(category, sample);
    }
    if (p.mcap_usd !== null) {
      if (!(p.tvl_usd > 0) || !Number.isFinite(p.mcap_usd / p.tvl_usd)) {
        throw new SnapshotError(`protocol ${p.slug} has no usable market cap / TVL ratio`);
      }
      const ratio = p.mcap_usd / p.tvl_usd;
      sample.push(ratio);
      ratios.push(ratio);
    }
  }
  if (ratios.length === 0) throw new SnapshotError('the snapshot has no live-token comparables');
  ratios.sort((a, b) => a - b);
  const globalMedian = percentile(ratios, 0.5);
  if (!(globalMedian > 0) || !Number.isFinite(globalMedian)) {
    throw new SnapshotError('the snapshot has no positive global median market cap / TVL ratio');
  }
  const categories = [...grouped].sort(([a], [b]) => compareText(a, b)).map(([category, sample]) => {
    sample.sort((a, b) => a - b);
    const n = sample.length;
    const median = n > 0 ? percentile(sample, 0.5) : null;
    const applied = n >= MIN_CATEGORY_SAMPLES && median !== null
      ? (n * median + SHRINKAGE * globalMedian) / (n + SHRINKAGE)
      : globalMedian;
    return {
      category,
      live_count: n,
      median_ratio: median,
      p25_ratio: n > 0 ? percentile(sample, 0.25) : null,
      p75_ratio: n > 0 ? percentile(sample, 0.75) : null,
      applied_ratio: applied,
      risk_multiplier: RISK_MULTIPLIERS[sectorOf(category)],
    };
  });
  return { globalMedian, categories, byCategory: new Map(categories.map((c) => [c.category, c])) };
}

/** Score one protocol using a supplied snapshot-derived ratio and sector risk. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  appliedRatio: number | null = model.base_multiple,
  riskMultiplier = 1,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  if (appliedRatio === null || !Number.isFinite(appliedRatio)) {
    throw new SnapshotError('a snapshot-derived market cap / TVL ratio is required to score a protocol');
  }
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const value = Math.round(protocol.tvl_usd * appliedRatio * growthMult * maturityMult * riskMultiplier);
  const implied = Math.min(MAX_VALUE_USD, Math.max(1, value));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** No recorded market cap, token identifier or symbol means the snapshot records no token. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Keep exchanges, versioned pools and named wrapped or staking products out of the early candidates. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !WRAPPED_PRODUCT.test(p.name);
}

/** Combine an action with cost and time while retaining the gate's bounds. */
export function stepText(step: FarmStep): string {
  const suffix = ` Cost: ${step.cost}. Time: ${step.time}.`;
  const text = `${step.text.slice(0, Math.max(0, 600 - suffix.length))}${suffix}`;
  return text.length >= 20 ? text.slice(0, 600) : `${text} Check the protocol before taking action.`;
}

interface FarmContext {
  name: string;
  chain: string;
}

/** Actions are examples, conditional on the protocol actually supporting the product and route. */
const FARM_ACTIONS: Record<Sector, (c: FarmContext) => FarmStep[]> = {
  Lending: ({ name, chain }) => [
    { text: `Supply $25 of a supported asset to a ${name} lending market on ${chain}, if its minimum permits.`, cost: '$25 example deposit plus variable network fees', time: '10 minutes' },
    { text: `After a week, check the ${name} position and withdraw a small amount if withdrawals are available.`, cost: 'Variable network fees and possible deposit losses', time: '5 minutes' },
  ],
  DEX: ({ name, chain }) => [
    { text: `Swap $10 of a supported token through a ${name} pool on ${chain}; review the price before confirming.`, cost: '$10 example trade plus variable swap and network fees', time: '5 minutes' },
    { text: `If ${name} offers liquidity pools, add $25 across the two pool assets and review impermanent loss.`, cost: '$25 example liquidity plus variable network fees', time: '10 minutes' },
  ],
  Yield: ({ name, chain }) => [
    { text: `Deposit $25 of a supported asset in a ${name} vault on ${chain}, if its minimum permits.`, cost: '$25 example deposit plus variable network fees', time: '10 minutes' },
    { text: `Check the ${name} vault balance after a week and withdraw a small amount if the vault allows it.`, cost: 'Variable network fees and possible strategy losses', time: '5 minutes' },
  ],
  Perp: ({ name, chain }) => [
    { text: `If ${name} supports derivatives on ${chain}, deposit $25 of accepted margin and check the rules.`, cost: '$25 example margin plus variable network fees', time: '10 minutes' },
    { text: `If a suitable market is available, open and close its smallest position at low leverage.`, cost: 'Variable trading fees and possible loss of margin', time: '10 minutes' },
  ],
  CDP: ({ name, chain }) => [
    { text: `Supply $25 of accepted collateral to a ${name} vault on ${chain}, if its minimum permits.`, cost: '$25 example collateral plus variable network fees', time: '10 minutes' },
    { text: `If the vault permits it, mint a small amount of its stablecoin and keep a wide liquidation buffer.`, cost: 'Variable network and stability fees; collateral is at risk', time: '10 minutes' },
  ],
  'Liquid Staking-adjacent': ({ name, chain }) => [
    { text: `Stake $25 of the asset supported by ${name} on ${chain} if the minimum and lockup are acceptable.`, cost: '$25 example stake plus variable network fees', time: '10 minutes' },
    { text: `Check the ${name} receipt and withdrawal queue; request a small unstake if the product allows it.`, cost: 'Variable network fees and possible withdrawal delay', time: '5 minutes' },
  ],
  'Bridge-adjacent': ({ name, chain }) => [
    { text: `Use ${name} to bridge $25 of a supported asset on a route that includes ${chain}, if available.`, cost: '$25 example transfer plus variable bridge and network fees', time: '10 minutes' },
    { text: `Check the destination wallet for the transfer, then return a small amount if a return route exists.`, cost: 'Variable bridge and network fees on the return route', time: '10 minutes' },
  ],
  Restaking: ({ name, chain }) => [
    { text: `Review slashing and lockup terms, then restake $25 through ${name} on ${chain} if permitted.`, cost: '$25 example stake plus variable network fees and slashing risk', time: '15 minutes' },
    { text: `Check the ${name} receipt and, if available, request a partial withdrawal and note the unbonding time.`, cost: 'Variable network fees and possible withdrawal delay', time: '5 minutes' },
  ],
  RWA: ({ name, chain }) => [
    { text: `Check ${name} eligibility, identity requirements, deposit minimum and redemption rules on ${chain}.`, cost: '$0 to review; identity checks may be required', time: '10 minutes' },
    { text: `If eligible and the minimum permits, deposit $25 into a supported ${name} real-world asset vault.`, cost: '$25 example deposit plus variable fees; minimums may be higher', time: '15 minutes' },
  ],
  Other: ({ name, chain }) => [
    { text: `Review the products ${name} lists on ${chain} and select one with terms and fees you understand.`, cost: '$0 to review the available product', time: '10 minutes' },
    { text: `If the selected ${name} product accepts deposits, deposit $25 and check the resulting balance.`, cost: '$25 example deposit plus variable network fees', time: '10 minutes' },
  ],
};

/** Four actionable steps from the recorded category and chain, with illustrative costs and times. */
export function farmSteps(p: SnapshotProtocol, _age: number | null): FarmStep[] {
  const name = p.name.slice(0, 100);
  const chain = (p.chains[0] || 'a supported network').slice(0, 80);
  return [
    { text: `Open the ${name} app, choose ${chain}, and review its supported assets before connecting a compatible wallet.`, cost: '$0 before any transaction', time: '5 minutes' },
    { text: `Fund a compatible wallet on ${chain} with an asset the app accepts and reserve funds for network fees.`, cost: '$25 example capital plus variable network fees', time: '10 minutes' },
    ...FARM_ACTIONS[sectorOf(p.category)]({ name, chain }),
  ];
}

/** The watchlist plus eligible below-floor protocols, sorted by value with stable slug tie breaks. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, calibration: Calibration = calibrate(snapshot)): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p === undefined) throw new SnapshotError(`watchlist slug ${slug} is missing from protocols`);
    if (!isPreToken(p)) throw new SnapshotError(`watchlist slug ${slug} records a token`);
    chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareText(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const category = calibration.byCategory.get(categoryOf(p.category));
    const ratio = category?.applied_ratio ?? calibration.globalMedian;
    const sector = sectorOf(p.category);
    const risk = RISK_MULTIPLIERS[sector];
    const result = impliedValue(p, snapshot.as_of, model, ratio, risk);
    return { p, category, ratio, sector, risk, ...result };
  });
  scored.sort((a, b) => b.implied - a.implied || compareText(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    ...s.p,
    rank: i + 1,
    token_status: 'pre-token',
    sector: s.sector,
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: calibration.globalMedian,
      sector_multiple: s.ratio,
      sector_samples: s.category?.live_count ?? 0,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
      risk_multiplier: s.risk,
      tvl_usd: s.p.tvl_usd,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The observed market caps are displayed separately from the modelled board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || compareText(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd! / p.tvl_usd,
    }));
}

/** The dashboard gets the same numbers and structured actions as board.json. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    sector: row.sector,
    on_watchlist: row.on_watchlist,
    farm_steps: farmSteps(row, row.age_days),
    value: row.model,
  };
}

/** Build a board and the matching data.js payload from one calibration. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot);
  const board = buildBoard(snapshot, model, calibration);
  const live = liveRows(snapshot);
  const watchlistRows = board.filter((row) => row.on_watchlist).length;
  const early = board.length - watchlistRows;
  const values = board.map((row) => row.implied_value_usd).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...model, base_multiple: calibration.globalMedian },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    categories: calibration.categories,
    stats: {
      median_implied_usd: values.length > 0 ? percentile(values, 0.5) : 0,
      total_implied_usd: values.reduce((total, value) => total + value, 0),
      watchlist_rows: watchlistRows,
      early_rows: early,
    },
    model_notes: [
      'Live-token market cap divided by TVL supplies the global and exact-category comparable ratios.',
      'Category medians with at least 3 live samples are shrunk toward the global median with weight 8; smaller samples use the global median.',
      'Growth is clamped to -60% through 120% and weighted by 0.5; missing growth is treated as 0%.',
      'Maturity rises from 0.6 to 1.0 over 1,095 days; missing listing age uses 365 days.',
      'The sector risk adjustment is subjective. Implied value is an estimate, not a token price or a launch prediction.',
      'Farm amounts and times are examples, fees vary, product availability is not verified, and a reward is not guaranteed.',
    ],
  };
  return { board, radar };
}

/** Parse the sealed input, refusing malformed values needed for scoring. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a positive TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Return the first reason the board would fail the gate, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4_000) return `the board has ${board.length} rows, outside 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const row of board) {
    if (typeof row.slug !== 'string' || row.slug.length < 1 || row.slug.length > 128 || /\s/.test(row.slug) || !known.has(row.slug)) return `invalid protocol slug ${row.slug}`;
    if (slugs.has(row.slug)) return `duplicate protocol slug ${row.slug}`;
    slugs.add(row.slug);
    if (typeof row.name !== 'string' || row.name.trim().length === 0) return `${row.slug} has no name`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > MAX_VALUE_USD) return `${row.slug} has invalid implied value ${row.implied_value_usd}`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has an invalid farm plan`;
    for (const step of row.farm_steps) {
      if (typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600) return `${row.slug} has an invalid farm step`;
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranked = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i]!.rank !== i + 1) return `rank ${i + 1} is ${ranked[i]!.rank}`;
    if (i > 0 && ranked[i]!.implied_value_usd > ranked[i - 1]!.implied_value_usd) return `rank ${i + 1} has a greater value than rank ${i}`;
  }
  if (ranked[0]!.implied_value_usd === ranked[ranked.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  return null;
}

/** Offline dashboard payload, with no fetch or network access. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
