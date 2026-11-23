import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RadarData, Snapshot } from './lib/model.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const USAGE = [
  'usage: node main.ts [--input <file|dir>] [--output <dir>] [--summary]',
  '',
  '  --input   snapshot file, or a directory holding snapshot.json (default /input)',
  '  --output  directory for board.json, data.js, dossier.json and assets',
  '            (default $MAKEFUN_OUTPUT_DIR, else /output)',
  '  --summary also print the model notes and the top five rows',
  '  --quiet   suppress the summary lines',
].join('\n');

interface Options {
  input: string;
  output: string;
  summary: boolean;
  quiet: boolean;
}

class UsageError extends Error {}

function optionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

function parseArgs(argv: string[]): Options | null {
  const options: Options = {
    input: '/input',
    output: process.env.MAKEFUN_OUTPUT_DIR ?? '/output',
    summary: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === '--input') {
      options.input = optionValue(argv, i, arg);
      i += 1;
    } else if (arg === '--output') {
      options.output = optionValue(argv, i, arg);
      i += 1;
    } else if (arg === '--summary') {
      options.summary = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      throw new UsageError(`unknown argument ${arg}`);
    }
  }
  return options;
}

function snapshotFile(input: string): string {
  if (!existsSync(input)) throw new SnapshotError(`no snapshot at ${input}`);
  return statSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
}

function copyTree(from: string, to: string): void {
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new Error(`missing asset directory ${from}`);
  mkdirSync(to, { recursive: true });
  const entries = readdirSync(from, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) copyFileSync(source, target);
  }
}

function report(radar: RadarData, protocols: number, options: Options): void {
  if (options.quiet) return;
  const lines = [
    `${protocols} protocols, watchlist ${radar.watchlist_size}, rows ${radar.board_size}, early ${radar.early_size}, live ${radar.live_size}`,
    `${radar.categories.length} categories, global median ratio ${radar.model.base_multiple}`,
  ];
  if (options.summary) {
    for (const note of radar.model_notes) lines.push(`note: ${note}`);
    for (const row of radar.rows.slice(0, 5)) lines.push(`${row.rank} ${row.slug} ${row.implied_value_usd} ${row.sector}`);
  }
  for (const line of lines) process.stderr.write(`${line}\n`);
}

function run(options: Options): number {
  const file = snapshotFile(options.input);
  if (!existsSync(file)) throw new SnapshotError(`no snapshot at ${file}`);
  const snapshot: Snapshot = parseSnapshot(readFileSync(file, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`board gate failed: ${issue}\n`);
    return 1;
  }
  mkdirSync(options.output, { recursive: true });
  writeFileSync(join(options.output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(options.output, 'data.js'), dataScript(radar));
  copyTree(join('.', 'dashboard'), join(options.output, 'dashboard'));
  copyTree(join('.', 'screenshots'), join(options.output, 'screenshots'));
  writeFileSync(join(options.output, 'dossier.json'), buildDossier(options.output, { text_max_bytes: 65536 }));
  report(radar, snapshot.protocols.length, options);
  return 0;
}

function main(argv: string[]): number {
  let options: Options | null;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  if (options === null) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    return run(options);
  } catch (error) {
    const known = error instanceof SnapshotError || error instanceof UsageError;
    process.stderr.write(`${(error as Error).message}\n`);
    return known ? 2 : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
