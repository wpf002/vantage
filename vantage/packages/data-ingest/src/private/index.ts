/**
 * Private-side live data fetchers. ALL FREE except the Anthropic intel call.
 *
 * Each fetcher takes its credentials as parameters (no process.env reads in
 * library code), enforces an AbortController timeout, Zod-validates the
 * upstream response, and throws UpstreamError naming the service on failure.
 */

export { fetchPeerMedians } from './fmp-peer-data.js';
export type { PeerMedians, PeerSnapshot } from './fmp-peer-data.js';

export { fetchGitHubVelocity } from './github.js';
export type { GitHubVelocity } from './github.js';

export { fetchPatentActivity } from './uspto.js';
export type { PatentActivity } from './uspto.js';

export { fetchFormDActivity } from './sec-edgar.js';
export type { FormDActivity } from './sec-edgar.js';

export { fetchTrancoRank } from './tranco.js';
export type { TrancoRank } from './tranco.js';

export { fetchMacroEnvironment } from './macro.js';
export type { MacroEnvironment } from './macro.js';

export { fetchCompanyIntel, CompanyIntel } from './news-intel.js';
export type { CompanyIntelConfig } from './news-intel.js';
