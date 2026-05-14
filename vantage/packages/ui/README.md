# @vantage/ui

Next.js 15 (App Router) dashboard. Editorial design — FT × Economist × Bloomberg Businessweek discipline.

## Design tokens

| Token | Value | Use |
|-------|-------|-----|
| `cream` | `#F5F2EC` | Page background |
| `ink` (and scale) | `#15161A` | All text, hairline rules |
| `editorial` | `#A8201A` | The single accent — signal labels, base-valuation marker, "View chain" links |
| `font-display` | Playfair Display | Headlines, signal labels, wordmark |
| `font-serif` | Source Serif 4 | Body copy, table cells with names |
| `font-sans` | Inter | UI chrome (nav, eyebrow labels, buttons) |
| `font-mono` | IBM Plex Mono | All numbers, timestamps, tickers, audit ops |

**Color discipline:** Editorial red is the ONLY accent. No green for bullish. Direction is conveyed by type weight + label, not heat color.

## Routes

- `/` — masthead + search + quick picks rail + three-column explainer
- `/public/[ticker]` — Public score tear sheet
- `/private/[id]` — Private valuation tear sheet  
- `/portfolio` — Sleeve breakdown + allocations
- `/simulation` — Monte Carlo, scenario tree, regime switching
- `/audit` — Signal log, click through for full lineage

## Reusable components

- `<Header />` — Playfair wordmark + nav
- `<SignalLabel />` — Editorial deck for a signal (label + score + confidence)
- `<ValuationBand />` — Bear/Base/Bull cell row + hairline scale
- `<AuditChain />` — Numbered transform-chain list

## SKU scaling

Same shell, different density:
- **Vantage Pro** (institutional): the FT research piece — full audit chains visible, peer sets exposed
- **Vantage Signals** (prosumer): the Businessweek feature — signal label + score only, audit collapsed
- **Vantage Meridian** (sophisticated retail): mid-density, classification and portfolio surfaces foregrounded
