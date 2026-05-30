import {
  BASE_FEE,
  Networks,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * Parses the on-chain job ID from the Soroban contract return value XDR.
 *
 * The escrow contract's `create_job` function returns a `u64` representing the
 * sequential job ID. After a successful transaction, the return value is passed
 * as a base64-encoded `ScVal` XDR string.
 *
 * @param returnValueXdr - Base64-encoded ScVal XDR from the transaction's return value
 * @returns The on-chain job ID as a number
 * @throws Error if the XDR cannot be parsed or does not contain a valid u64 value
 */
export function parseJobIdFromResult(returnValueXdr: string): number {
  if (!returnValueXdr) {
    throw new Error("No return value XDR provided — cannot extract on-chain job ID");
  }

  try {
    const scVal = xdr.ScVal.fromXDR(returnValueXdr, "base64");

    // The contract returns Result<u64, EscrowError>.
    // On success, Soroban unwraps the Ok variant and the return value is the u64 directly.
    if (scVal.switch().name === "scvU64") {
      return Number(scVal.u64());
    }

    // Fallback: check if it's wrapped in an Ok variant (scvVec with Ok tag)
    throw new Error(
      `Unexpected ScVal type "${scVal.switch().name}" — expected scvU64 for the on-chain job ID`
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("on-chain job ID")) {
      throw err;
    }
    throw new Error(
      `Failed to parse on-chain job ID from transaction result: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export type TransactionPreview = {
  preparedXdr: string;
  estimatedResourceFeeStroops: bigint;
  estimatedTotalFeeStroops: bigint;
  requiresRestoreFootprint: boolean;
};

/**
 * Simulates a Soroban transaction and prepares it for signing.
 */
export async function prepareSorobanTransaction(
  transactionXdr: string,
): Promise<TransactionPreview> {
  if (!transactionXdr) {
    throw new Error("No transaction XDR provided.");
  }

  const server = new rpc.Server(RPC_URL);
  const transaction = TransactionBuilder.fromXDR(
    transactionXdr,
    NETWORK_PASSPHRASE,
  ) as Transaction;

  const simulation = await server.simulateTransaction(transaction);

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(simulation.error || "Transaction simulation failed.");
  }

  if (!simulation.transactionData) {
    throw new Error("Simulation did not return Soroban transaction data.");
  }

  const resourceFee = BigInt(simulation.minResourceFee ?? "0");
  const totalFee = BigInt(BASE_FEE.toString()) + resourceFee;

  const preparedTransaction = TransactionBuilder.cloneFrom(transaction, {
    fee: totalFee.toString(),
  }).setSorobanData(simulation.transactionData);

  return {
    preparedXdr: preparedTransaction.build().toXDR(),
    estimatedResourceFeeStroops: resourceFee,
    estimatedTotalFeeStroops: totalFee,
    requiresRestoreFootprint: Boolean(simulation.restorePreamble),
  };
}
