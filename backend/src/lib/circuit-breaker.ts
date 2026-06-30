import { logger } from "./logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;  // failures before opening (default: 5)
  openDurationMs?: number;    // ms to stay open before probing (default: 60_000)
  name?: string;              // label for log messages
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  reconnectAttempts: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureAt: number | null = null;
  private openedAt: number | null = null;
  private reconnectAttempts = 0;

  private readonly failureThreshold: number;
  private readonly openDurationMs: number;
  private readonly name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.openDurationMs = opts.openDurationMs ?? 60_000;
    this.name = opts.name ?? "CircuitBreaker";
  }

  /** Returns true when the circuit allows a call to proceed. */
  allowRequest(): boolean {
    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed >= this.openDurationMs) {
        this.state = "HALF_OPEN";
        this.reconnectAttempts += 1;
        logger.info(
          { name: this.name, reconnectAttempts: this.reconnectAttempts },
          `[${this.name}] Circuit half-open — sending probe`,
        );
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow the single probe through
    return true;
  }

  /** Call after a successful operation. */
  onSuccess(): void {
    if (this.state !== "CLOSED") {
      logger.info(
        { name: this.name, previousState: this.state, metric: "rpc_circuit_closed" },
        `[${this.name}] Circuit closed — service recovered`,
      );
    }
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
  }

  /** Call after a failed operation. */
  onFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = Date.now();

    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.reconnectAttempts += 1;
      logger.warn(
        { name: this.name, consecutiveFailures: this.consecutiveFailures, metric: "rpc_circuit_open" },
        `[${this.name}] Circuit reopened after failed probe`,
      );
      return;
    }

    if (
      this.consecutiveFailures >= this.failureThreshold &&
      this.state === "CLOSED"
    ) {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.reconnectAttempts += 1;
      logger.warn(
        {
          name: this.name,
          consecutiveFailures: this.consecutiveFailures,
          metric: "rpc_circuit_open",
          [`${this.name.toLowerCase().replace(/\s+/g, "_")}_reconnects_total`]:
            this.reconnectAttempts,
        },
        `[${this.name}] Circuit opened — service unreachable`,
      );
    }
  }

  /** Snapshot of current state (safe to read from outside). */
  getStatus(): Readonly<CircuitBreakerStatus> {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      openedAt: this.openedAt,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /** Map circuit state to a human-readable health string. */
  getHealthLabel(): "connected" | "degraded" | "down" {
    if (this.state === "CLOSED") return "connected";
    if (this.state === "HALF_OPEN") return "degraded";
    return "down";
  }
}
