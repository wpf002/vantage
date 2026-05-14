import { z } from 'zod';
import { UpstreamError } from '@vantage/shared';

/**
 * Bridge to the Python ML service. The XGBoost model takes alt-data features
 * and predicts a multiplicative adjustment to the pre-ML blended valuation.
 * SHAP values explain which features contributed most.
 */

export const MlAdjustmentRequest = z.object({
  companyId: z.string(),
  preMlValuation: z.number(),
  features: z.record(z.number()), // alt-data feature vector
});
export type MlAdjustmentRequest = z.infer<typeof MlAdjustmentRequest>;

export const MlAdjustmentResponse = z.object({
  delta: z.number(), // multiplicative adjustment, e.g. 0.12 = +12%
  direction: z.enum(['up', 'down', 'neutral']),
  shap: z.record(z.number()),
  modelVersion: z.string(),
});
export type MlAdjustmentResponse = z.infer<typeof MlAdjustmentResponse>;

export interface MlBridgeConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export async function requestMlAdjustment(
  req: MlAdjustmentRequest,
  config: MlBridgeConfig,
): Promise<MlAdjustmentResponse> {
  const validated = MlAdjustmentRequest.parse(req);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const resp = await fetch(`${config.baseUrl}/v1/adjust`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
      },
      body: JSON.stringify(validated),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new UpstreamError('ml-service', `HTTP ${resp.status}`);
    }
    const json = await resp.json();
    return MlAdjustmentResponse.parse(json);
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError('ml-service', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeout);
  }
}
