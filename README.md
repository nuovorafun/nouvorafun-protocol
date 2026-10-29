# Nuovora

Think freely. Keep every word.

[![Live site](https://img.shields.io/badge/live%20site-nuovora.fun-3796d2?style=flat-square)](https://nuovora.fun)

| | |
|---|---|
| Chain | Robinhood Chain |
| Contract | `pending` (to be announced) |
| Site | [nuovora.fun](https://nuovora.fun) |

## Overview

Nuovora is a confidential workspace for talking things through, making new material and building small tools, living on Robinhood Chain. This repository holds the static site: a single page with a live market view for the ten busiest Robinhood pairs.

## Features

- Live market board and ticker, refreshed every minute while the tab is visible, with backoff and last-good data on failure
- Contract slot at the top of the page, inert until the address is confirmed, then click-to-copy
- Record-driven links: social icons render inert until a real URL is recorded
- Spring-physics reveals, layered hero parallax, spotlight hovers and a scroll progress bar, all with a reduced-motion fallback
- Zero runtime dependencies, deployable as plain files

## Links

- Site: [nuovora.fun](https://nuovora.fun)
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Development

```bash
npm install
npm run build   # writes dist/
npm run gates   # runs the verification gates against dist/
npm start       # serves dist/ on http://localhost:4173
```

Deploy by uploading the `dist/` folder.

## License

MIT. See [LICENSE](LICENSE).
