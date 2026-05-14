import { z } from 'zod';

/**
 * Conversational interface — Phase 7 stub.
 *
 * Defines the tool/intent contract a chat layer (LLM-orchestrated)
 * will route to. The LLM only chooses tools and renders responses;
 * actual scoring, classification, and allocation are still deterministic.
 */

export const Intent = z.enum([
  'lookup_company',
  'value_private',
  'score_public',
  'classify',
  'build_portfolio',
  'simulate',
  'audit_lineage',
]);
export type Intent = z.infer<typeof Intent>;

export const ToolCall = z.object({
  intent: Intent,
  params: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ChatTurn = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  toolCalls: z.array(ToolCall).optional(),
});
export type ChatTurn = z.infer<typeof ChatTurn>;

/**
 * Tool registry — every intent maps to an API endpoint.
 * Filled in during Phase 7. Stub here for the contract.
 */
export const TOOL_REGISTRY: Record<Intent, { endpoint: string; method: 'GET' | 'POST' }> = {
  lookup_company: { endpoint: '/v1/companies/:id', method: 'GET' },
  value_private: { endpoint: '/v1/private/value', method: 'POST' },
  score_public: { endpoint: '/v1/public/score', method: 'POST' },
  classify: { endpoint: '/v1/classify', method: 'POST' },
  build_portfolio: { endpoint: '/v1/portfolio/construct', method: 'POST' },
  simulate: { endpoint: '/v1/simulation/run', method: 'POST' },
  audit_lineage: { endpoint: '/v1/audit/:signalId', method: 'GET' },
};
