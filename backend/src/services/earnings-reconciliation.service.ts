import { Horizon } from "@stellar/stellar-sdk";
import { config } from "../config";
import { logger } from "../lib/logger";

/**
 * A payment that settled on-chain to the freelancer's wallet, as reported by Horizon.
 * Escrow releases carry the related `jobId` in the transaction memo (memo_type "text").
 */
export interface OnChainPayment {
  txHash: string;
  /** jobId parsed from the transaction memo, when present. */
  memoJobId: string | null;
  /** Amount of the payment (Horizon reports issued/native amounts as decimal strings). */
  amount: number;
  /** Asset code — "XLM" for native, otherwise the issued asset code. */
  assetCode: string;
  createdAt: string;
  from: string;
}

const HORIZON_PAGE_LIMIT = 200;

let cachedServer: Horizon.Server | null = null;

function getServer(): Horizon.Server {
  if (!cachedServer) {
    cachedServer = new Horizon.Server(config.stellar.horizonUrl);
  }
  return cachedServer;
}

/**
 * Minimal shape of the Horizon payment records we consume. Typed locally rather
 * than via deep `Horizon.ServerApi.*` aliases so the service is resilient to
 * SDK minor-version type churn.
 */
interface HorizonPaymentRecord {
  type: string;
  to?: string;
  from?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  created_at: string;
  transaction_hash: string;
  transaction: () => Promise<{ memo_type?: string; memo?: string }>;
}

const PAYMENT_TYPES = new Set([
  "payment",
  "path_payment_strict_send",
  "path_payment_strict_receive",
]);

/**
 * Fetch every inbound payment credited to `walletAddress` between `from` and
 * `to`, walking Horizon's pagination cursor until the window closes.
 *
 * Records are requested oldest-first so the date filter can short-circuit once
 * we pass the `to` boundary.
 */
export async function fetchOnChainPayments(
  walletAddress: string,
  from: Date,
  to: Date,
): Promise<OnChainPayment[]> {
  const server = getServer();
  const results: OnChainPayment[] = [];

  let page = await server
    .payments()
    .forAccount(walletAddress)
    .order("asc")
    .limit(HORIZON_PAGE_LIMIT)
    .call();

  while (page.records.length > 0) {
    for (const raw of page.records as unknown as HorizonPaymentRecord[]) {
      const createdAt = new Date(raw.created_at);
      if (createdAt < from) continue;
      if (createdAt > to) return results;

      if (!PAYMENT_TYPES.has(raw.type)) continue;
      // Only inbound payments to the freelancer count as earnings.
      if (raw.to !== walletAddress) continue;

      let memoJobId: string | null = null;
      try {
        const tx = await raw.transaction();
        if (tx.memo_type === "text" && tx.memo) {
          memoJobId = tx.memo;
        }
      } catch (err) {
        logger.warn(
          { err, txHash: raw.transaction_hash },
          "[Reconciliation] Failed to load tx memo",
        );
      }

      results.push({
        txHash: raw.transaction_hash,
        memoJobId,
        amount: Number(raw.amount ?? 0),
        assetCode: raw.asset_type === "native" ? "XLM" : raw.asset_code ?? "UNKNOWN",
        createdAt: raw.created_at,
        from: raw.from ?? "",
      });
    }

    page = await page.next();
  }

  return results;
}
