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
// Farm plans follow the recorded TVL band for the test ticket, the first listed chain for gas and
// bridging, the recorded seven-day change and the listing age. Amounts and times are examples, not
// observed fees or eligibility claims. Network and product fees vary, and no reward is guaranteed.

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
  otherChains: string[];
  category: string;
  tvl: string;
  depositText: string;
  smallText: string;
  share: string;
  gas: string;
  gasRange: string;
  roundTrip: string;
  momentum: number | null;
}

interface ChainGas {
  range: string;
  mid: number;
}

/** Typical mainnet cost of one approval plus one contract call; a plan filter, not a quote. */
const CHAIN_GAS: Record<string, ChainGas> = {
  Ethereum: { range: '$2 to $8', mid: 5 },
  Arbitrum: { range: '$0.05 to $0.40', mid: 0.2 },
  Optimism: { range: '$0.05 to $0.30', mid: 0.15 },
  Base: { range: '$0.02 to $0.20', mid: 0.1 },
  Binance: { range: '$0.05 to $0.30', mid: 0.15 },
  Polygon: { range: '$0.01 to $0.10', mid: 0.04 },
  Solana: { range: '$0.01 to $0.05', mid: 0.02 },
  Avalanche: { range: '$0.05 to $0.60', mid: 0.3 },
  Bitcoin: { range: '$2 to $10', mid: 6 },
  Tron: { range: '$1 to $3', mid: 2 },
  'Hyperliquid L1': { range: '$0.01 to $0.10', mid: 0.04 },
  Monad: { range: '$0.01 to $0.10', mid: 0.04 },
  Plasma: { range: '$0.01 to $0.10', mid: 0.04 },
  Sonic: { range: '$0.01 to $0.10', mid: 0.04 },
  Linea: { range: '$0.05 to $0.50', mid: 0.2 },
  Scroll: { range: '$0.05 to $0.50', mid: 0.2 },
  'zkSync Era': { range: '$0.05 to $0.50', mid: 0.2 },
  Mantle: { range: '$0.02 to $0.20', mid: 0.08 },
  Berachain: { range: '$0.02 to $0.20', mid: 0.08 },
  Unichain: { range: '$0.02 to $0.20', mid: 0.08 },
  Sui: { range: '$0.01 to $0.10', mid: 0.03 },
  Celo: { range: '$0.01 to $0.10', mid: 0.03 },
  Fantom: { range: '$0.01 to $0.10', mid: 0.04 },
  xDai: { range: '$0.01 to $0.05', mid: 0.02 },
  Sei: { range: '$0.01 to $0.10', mid: 0.04 },
  Stellar: { range: '$0.01 to $0.05', mid: 0.02 },
  Ripple: { range: '$0.01 to $0.05', mid: 0.02 },
  TON: { range: '$0.01 to $0.05', mid: 0.03 },
  Cardano: { range: '$0.10 to $0.50', mid: 0.25 },
  'Robinhood Chain': { range: '$0.05 to $0.50', mid: 0.2 },
  Arc: { range: '$0.01 to $0.10', mid: 0.04 },
  Ink: { range: '$0.02 to $0.20', mid: 0.08 },
  Katana: { range: '$0.01 to $0.10', mid: 0.04 },
  Flare: { range: '$0.01 to $0.10', mid: 0.04 },
};

/** Gas for a chain outside the table, grouped by the fee market it resembles. */
function chainGas(chain: string): ChainGas {
  const known = CHAIN_GAS[chain];
  if (known !== undefined) return known;
  if (/bitcoin|btc|litecoin|dogecoin/i.test(chain)) return { range: '$1 to $10', mid: 4 };
  if (/solana|sui|aptos|ton|near|stellar|ripple/i.test(chain)) return { range: '$0.01 to $0.10', mid: 0.04 };
  if (/cosmos|osmosis|injective|kava|neutron|babylon|core|celestia|dydx/i.test(chain)) return { range: '$0.01 to $0.20', mid: 0.06 };
  if (/eth|linea|scroll|zksync|arbitrum|optimism|base|polygon|gnosis|avalanche|fantom|celo|mantle|blast|berachain|unichain|ink|morph|world|bob|hemi|citrea|fluent|pharos|plume|stable|tempo|monad|plasma|sonic|telos|sei|x layer/i.test(chain)) {
    return { range: '$0.02 to $0.50', mid: 0.2 };
  }
  return { range: '$0.10 to $2', mid: 0.5 };
}

/** How a deposit reaches the chain, stated as a typical cost rather than a quote. */
function bridgeNote(chain: string): string {
  if (/^ethereum$/i.test(chain)) return 'no bridge fee applies while the funds already sit on Ethereum.';
  return 'if the funds start on Ethereum or another chain, a bridge hop costs about $1 to $5 plus gas on each side, or an exchange withdrawal avoids it.';
}

/** US dollars with thousands separators, for ticket sizes. */
function money(n: number): string {
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** A short TVL label for use inside a sentence. */
function compactUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** The ticket as a share of recorded TVL, at a precision that survives small tickets. */
function shareOf(part: number, whole: number): string {
  const pct = (part / whole) * 100;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  if (pct >= 0.000001) return `${pct.toFixed(6)}%`;
  return 'less than 0.000001%';
}

/** An approximate dollar figure that keeps cents below one dollar. */
function aboutUsd(n: number): string {
  return n >= 1 ? `about $${Math.round(n)}` : `about $${n.toFixed(2)}`;
}

interface CapitalBand {
  label: string;
  deposit: number;
  ceiling: string;
}

/** Test ticket and the price-impact level that would contradict the recorded TVL. */
function capitalBand(tvl: number): CapitalBand {
  if (tvl < 10_000_000) return { label: 'under $10M', deposit: 100, ceiling: '1%' };
  if (tvl < 50_000_000) return { label: '$10M to $50M', deposit: 500, ceiling: '0.5%' };
  if (tvl < 250_000_000) return { label: '$50M to $250M', deposit: 1_000, ceiling: '0.3%' };
  return { label: 'above $250M', deposit: 5_000, ceiling: '0.1%' };
}

/** Wallet review, chain choice and the cost of reaching the first listed chain. */
function routeStep(c: FarmContext, chainCount: number): FarmStep {
  const route = chainCount === 0
    ? 'No chain is recorded, so confirm the network before funding anything.'
    : chainCount === 1
      ? 'It is the only chain recorded, so one gas balance covers the whole test and no bridge is needed.'
      : chainCount === 2
        ? `The snapshot lists ${c.chain} and ${c.otherChains.join(' and ')}; the plan stays on ${c.chain} so every step shares one network.`
        : `${chainCount} chains are recorded; this plan uses ${c.chain} for every step so the approval, the deposit and the exit stay on one route.`;
  return {
    text: `Open ${c.name} in a fresh wallet on ${c.chain} and find its ${c.category} product. ${route} Gas runs ${c.gasRange} per transaction; ${bridgeNote(c.chain)}`,
    cost: '$0 of fees to review, plus the bridge fee only if funds must move',
    time: '10 minutes',
  };
}

/** Ticket size for the recorded TVL band, with the price impact that size implies. */
function fundStep(c: FarmContext, band: CapitalBand): FarmStep {
  return {
    text: `Fund ${c.depositText} plus a buffer for gas. The snapshot records ${c.tvl} of TVL, the ${band.label} band, and ${c.depositText} is ${c.share} of that total: any price impact or fee in the preview should sit near that share, and a preview above ${band.ceiling} means the live venue is thinner than the recorded TVL suggests.`,
    cost: `${c.depositText} test deposit plus ${c.gas}`,
    time: '15 minutes',
  };
}

/** The recorded seven-day change decides whether the next move is a warning or a watch. */
function momentumStep(c: FarmContext): FarmStep {
  if (c.momentum === null) {
    return {
      text: `The snapshot records no seven-day change for ${c.name}, so treat the trend as unknown rather than stable: read the TVL history in the app and keep the first ticket at ${c.smallText}.`,
      cost: '$0 of fees to read the chart',
      time: '5 minutes',
    };
  }
  const figure = `${Math.abs(c.momentum).toFixed(2)}%`;
  if (c.momentum < -0.05) {
    return {
      text: `The snapshot records TVL down ${figure} over seven days at ${c.tvl}. Before ${c.depositText} goes in, check whether the drop is asset prices falling or depositors leaving, and stay at ${c.smallText} until a week closes flat or higher.`,
      cost: '$0 of fees to read the change',
      time: '10 minutes',
    };
  }
  if (c.momentum > 0.05) {
    return {
      text: `The snapshot records TVL up ${figure} over seven days at ${c.tvl}. Before adding, watch whether the next weekly figure holds and whether fee volume rises with it; TVL can jump from one large deposit without new users.`,
      cost: '$0 of fees to watch the next print',
      time: '10 minutes',
    };
  }
  return {
    text: `The snapshot records TVL flat over seven days at ${c.tvl}, so this is a clean week for the ${c.smallText} test; the thing to watch before adding size is the first move in either direction.`,
    cost: '$0 of fees to read the change',
    time: '5 minutes',
  };
}

/** A first-week test for new listings, a trend read for mid-age ones, a withdrawal test for old ones. */
function ageStep(c: FarmContext, age: number | null): FarmStep {
  if (age === null) {
    return {
      text: `No listing date is recorded for ${c.name}, so the record cannot show whether it is early or seasoned: find the deployment date before raising size and keep the first deposit at ${c.smallText}.`,
      cost: '$0 of fees to check the record',
      time: '15 minutes',
    };
  }
  if (age < 365) {
    return {
      text: `At ${age} days listed, ${c.name} is under a year old, so give it one small first week: deposit ${c.smallText} on day one, withdraw it on day seven, and only then commit the ${c.depositText} ticket.`,
      cost: `${c.smallText} test deposit plus ${c.roundTrip}`,
      time: '7 days',
    };
  }
  if (age < 1095) {
    const months = Math.round(age / 30.4);
    return {
      text: `${c.name} has about ${months} months listed, long enough to compare: read its TVL trend over that window and size the ticket from whether ${c.tvl} sits above or below the trend.`,
      cost: '$0 of fees to read the history',
      time: '20 minutes',
    };
  }
  return {
    text: `With ${age} days of record, ${c.name} can stand a real withdrawal test: deposit ${c.smallText}, withdraw it, and read the multi-year TVL trend before trusting the ${c.depositText} ticket to it.`,
    cost: `${c.smallText} test deposit plus ${c.roundTrip}`,
    time: '1 day',
  };
}

/** Each sector keeps its own action, bound to the ticket, chain and category the row records. */
const FARM_ACTIONS: Record<Sector, (c: FarmContext) => FarmStep[]> = {
  Lending: (c) => [
    { text: `Supply ${c.depositText} of an asset ${c.name} lists on ${c.chain} to the supply side of its ${c.category} market, then note the supply rate and collateral factor the app shows.`, cost: `${c.depositText} supplied plus ${c.gas}`, time: '15 minutes' },
    { text: `If ${c.name} shows an open borrow market, borrow at most ${c.smallText} against the ${c.depositText} supplied, then check the health factor and liquidation price it reports.`, cost: `${c.smallText} borrowed plus ${c.gas}`, time: '20 minutes' },
  ],
  DEX: (c) => [
    { text: `Swap ${c.smallText} through one ${c.name} pool on ${c.chain} and read the quoted price impact before signing; compare it with the ${c.share} of TVL that ticket represents.`, cost: `${c.smallText} swapped plus ${c.gas}`, time: '10 minutes' },
    { text: `If ${c.name} shows a two-asset pool, add ${c.depositText} split across both sides on ${c.chain}, then write down the fee tier and the impermanent-loss range the app reports.`, cost: `${c.depositText} of liquidity plus ${c.gas}`, time: '20 minutes' },
  ],
  Yield: (c) => [
    { text: `Deposit ${c.depositText} into one ${c.name} ${c.category} product on ${c.chain}, after reading which strategy it runs and who can pause withdrawals.`, cost: `${c.depositText} deposited plus ${c.gas}`, time: '15 minutes' },
    { text: `Leave ${c.name} a week, then withdraw ${c.smallText} and compare what came back with a plain hold of the same asset; that difference is the only return figure worth recording.`, cost: `${c.smallText} withdrawn plus ${c.gas}`, time: '7 days' },
  ],
  Perp: (c) => [
    { text: `Deposit ${c.depositText} of margin into ${c.name} on ${c.chain} and read the maximum leverage and liquidation price the market shows before opening anything.`, cost: `${c.depositText} of margin plus ${c.gas}`, time: '15 minutes' },
    { text: `Open the smallest position ${c.name} allows at 2x or less, close it in the same session, and record the fees charged on the full round trip.`, cost: `${c.smallText} of position plus ${c.gas}`, time: '20 minutes' },
  ],
  CDP: (c) => [
    { text: `Supply ${c.depositText} of a collateral asset ${c.name} accepts on ${c.chain} to open a vault, then read the liquidation threshold, minimum ratio and stability fee it displays.`, cost: `${c.depositText} of collateral plus ${c.gas}`, time: '20 minutes' },
    { text: `Mint at most ${c.smallText} of stablecoin against that ${c.name} vault, keep the ratio well above the minimum, and repay all of it before the week ends.`, cost: `${c.smallText} minted plus ${c.gas}`, time: '30 minutes' },
  ],
  'Liquid Staking-adjacent': (c) => [
    { text: `Stake ${c.depositText} of an asset ${c.name} accepts on ${c.chain}, then read the validator set, commission and unbonding terms listed for the ${c.category} product.`, cost: `${c.depositText} staked plus ${c.gas}`, time: '15 minutes' },
    { text: `If ${c.name} returns a receipt token, compare its balance with the ${c.depositText} staked, then request a ${c.smallText} unstake to see the queue the app reports.`, cost: `${c.smallText} unstaked plus ${c.gas}`, time: '1 day' },
  ],
  'Bridge-adjacent': (c) => [
    { text: `Send ${c.depositText} of an asset ${c.name} supports over a route that ends on ${c.chain}, and read the bridge fee plus destination gas estimate before approving.`, cost: `${c.depositText} transferred plus ${c.gas}`, time: '20 minutes' },
    { text: `Confirm the arrival in the destination wallet, then send ${c.smallText} back through ${c.name} to measure the round-trip time and what it charges.`, cost: `${c.smallText} returned plus ${c.gas}`, time: '30 minutes' },
  ],
  Restaking: (c) => [
    { text: `Read the slashing and unbonding terms ${c.name} lists, then restake ${c.depositText} on ${c.chain} only if the operator set and lockup are acceptable.`, cost: `${c.depositText} restaked plus ${c.gas}`, time: '20 minutes' },
    { text: `Request a ${c.smallText} partial withdrawal from ${c.name} after the restake, note the unbonding time and fee the app reports, and keep the receipt where you can find it.`, cost: `${c.smallText} withdrawn plus ${c.gas}`, time: '1 day' },
  ],
  RWA: (c) => [
    { text: `Read ${c.name} eligibility, jurisdiction and redemption terms on ${c.chain} before depositing, because an identity check can block a ${c.depositText} ticket after the money is already there.`, cost: '$0 of fees to read the terms', time: '15 minutes' },
    { text: `If eligible and the minimum is at or below ${c.depositText}, deposit that amount into the ${c.name} ${c.category} product and note the redemption window the app states.`, cost: `${c.depositText} deposited plus ${c.gas}`, time: '30 minutes' },
  ],
  Other: (c) => [
    { text: `Read what ${c.name} offers on ${c.chain} under the ${c.category} label, and pick one product whose fees and exit terms you can repeat without the marketing page.`, cost: '$0 of fees to review the product', time: '15 minutes' },
    { text: `If that ${c.name} product accepts deposits, deposit ${c.depositText}, confirm the balance appears, then withdraw ${c.smallText} the same day to test the exit.`, cost: `${c.depositText} deposited plus ${c.gas}`, time: '30 minutes' },
  ],
};

/** Six steps from the row's own TVL band, chain, category, seven-day change and listing age. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const name = p.name.slice(0, 100);
  const chains = p.chains.map((chain) => chain.trim()).filter((chain) => chain.length > 0);
  const chain = (chains[0] ?? 'a supported network').slice(0, 80);
  const gas = chainGas(chain);
  const band = capitalBand(p.tvl_usd);
  const context: FarmContext = {
    name,
    chain,
    otherChains: chains.slice(1, 3).map((other) => other.slice(0, 60)),
    category: categoryOf(p.category).slice(0, 60),
    tvl: compactUsd(p.tvl_usd),
    depositText: money(band.deposit),
    smallText: money(Math.max(20, Math.round(band.deposit / 5))),
    share: shareOf(band.deposit, p.tvl_usd),
    gas: `${aboutUsd(gas.mid)} of gas`,
    gasRange: gas.range,
    roundTrip: `${aboutUsd(gas.mid * 2)} of gas for the deposit and withdrawal`,
    momentum: p.change_7d,
  };
  return [
    routeStep(context, chains.length),
    fundStep(context, band),
    ...FARM_ACTIONS[sectorOf(p.category)](context),
    momentumStep(context),
    ageStep(context, age),
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
      'Farm tickets follow the recorded TVL band; amounts and times are examples, fees vary, product availability is not verified, and a reward is not guaranteed.',
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
