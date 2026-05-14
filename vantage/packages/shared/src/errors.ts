/**
 * Error taxonomy for Vantage. Every thrown error inherits from VantageError
 * so the API gateway can map cleanly to HTTP status codes.
 */

export class VantageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 500,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'VantageError';
  }
}

export class ValidationError extends VantageError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VANTAGE_VALIDATION', 400, context);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends VantageError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'VANTAGE_NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

export class InsufficientDataError extends VantageError {
  constructor(method: string, reason: string) {
    super(
      `${method} cannot be computed: ${reason}`,
      'VANTAGE_INSUFFICIENT_DATA',
      422,
      { method, reason },
    );
    this.name = 'InsufficientDataError';
  }
}

export class ConfidenceFloorError extends VantageError {
  constructor(method: string, confidence: number, floor: number) {
    super(
      `${method} confidence ${confidence.toFixed(2)} below floor ${floor.toFixed(2)}`,
      'VANTAGE_CONFIDENCE_FLOOR',
      422,
      { method, confidence, floor },
    );
    this.name = 'ConfidenceFloorError';
  }
}

export class UpstreamError extends VantageError {
  constructor(service: string, detail: string) {
    super(`Upstream ${service} failed: ${detail}`, 'VANTAGE_UPSTREAM', 502, { service, detail });
    this.name = 'UpstreamError';
  }
}
