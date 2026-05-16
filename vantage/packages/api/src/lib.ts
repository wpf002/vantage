/**
 * Library entry for @vantage/api — re-exports DB / store / job code so the
 * CLI (and tests, eventually) can reach the same primitives the HTTP layer
 * uses without booting Fastify.
 *
 * Booting the server lives in ./index.ts; importing that pulls in BullMQ,
 * helmet, etc. and triggers worker registration. Use this entry for the
 * pure-data pieces.
 */

export * as schema from './db/schema.js';
export { db, type DB } from './db/client.js';
export {
  persistPortfolio,
  getPortfolioById,
  getPortfolioBySlug,
  getSystemPortfolio,
  listUserPortfolios,
  listPublishedPortfolios,
  publishPortfolio,
  unpublishPortfolio,
  deletePortfolio,
  validateSlug,
  type PersistPortfolioParams,
  type PortfolioRowJoined,
  type PortfolioListItem,
} from './db/portfolioStore.js';
export { rebuildSystemPortfolio } from './jobs/systemPortfolio.js';
export {
  persistSimulation,
  getSimulationById,
  listPortfolioSimulations,
  type SimulationKind,
  type PortfolioSimulationListItem,
  type SimulationRow,
  type MonteCarloOutputsBlob,
  type PersistSimulationParams,
  type PersistSimulationResult,
} from './db/simulationStore.js';
