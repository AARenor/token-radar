# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AARenor/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AARenor/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The radar reads a snapshot of protocols and their watchlist. It estimates value by multiplying TVL by a category market-cap-to-TVL ratio calculated from the snapshot's live-token protocols, with shrinkage toward the global median, then applying seven-day growth, maturity and category risk multipliers.

The board ranks 214 rows and covers all 40 watchlist protocols. The dashboard provides the board, a detail view, filters and farm plans.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Entered on make.fun's "Build the best token launch radar" bounty, an MIT-licensed entry.
