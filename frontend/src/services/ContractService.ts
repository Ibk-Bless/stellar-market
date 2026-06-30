import {
  Account,
  Address,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { BadgeTier, ReputationTier } from "@/types";

export type ReputationResult = {
  score: number;
  badgeTier: ReputationTier;
  reviewCount: number;
};

export const DEFAULT_BADGE_TIERS: BadgeTier[] = [
  { name: "Bronze", minScore: 100, colour: "#CD7F32" },
  { name: "Silver", minScore: 300, colour: "#C0C0C0" },
  { name: "Gold", minScore: 500, colour: "#FFD700" },
  { name: "Platinum", minScore: 700, colour: "#E5E4E2" },
];

const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";

const REPUTATION_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REPUTATION_CONTRACT_ID || "";

const ESCROW_CONTRACT_ID = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID || "";

function getBadgeTier(averageRaw: number, tiers: BadgeTier[] = DEFAULT_BADGE_TIERS): ReputationTier {
  const sorted = [...tiers].sort((a, b) => b.minScore - a.minScore);
  for (const t of sorted) {
    if (averageRaw >= t.minScore) return t.name;
  }
  return "None";
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
}

function parse(native: unknown, tiers?: BadgeTier[]): ReputationResult | null {
  if (!native || typeof native !== "object") return null;

  const r = native as Record<string, unknown>;
  const totalScore = toNumber(r.total_score ?? r.totalScore);
  const totalWeight = toNumber(r.total_weight ?? r.totalWeight);
  const reviewCount = toNumber(r.review_count ?? r.reviewCount);

  if (!totalWeight) return null;

  const avgRaw = Math.floor(totalScore / totalWeight);

  return {
    score: avgRaw / 100,
    badgeTier: getBadgeTier(avgRaw, tiers),
    reviewCount,
  };
}

export class ContractService {
  static async getReputation(address: string, tiers?: BadgeTier[]): Promise<ReputationResult | null> {
    if (!address || !REPUTATION_CONTRACT_ID) return null;

    const server = new rpc.Server(RPC_URL);
    const contract = new Contract(REPUTATION_CONTRACT_ID);

    const source = new Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "0"
    );

    const tx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          "get_reputation",
          nativeToScVal(Address.fromString(address), { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(sim)) return null;

    const retval = sim.result?.retval;
    if (!retval) return null;

    const native = scValToNative(retval);
    return parse(native, tiers);
  }

  static async buildSubmitReviewTx(params: {
    reviewerPublicKey: string;
    revieweePublicKey: string;
    jobIdOnChain: string | number | bigint;
    rating: number;
    comment: string;
    stakeWeightStroops: string | number | bigint;
  }): Promise<string> {
    if (!REPUTATION_CONTRACT_ID) {
      throw new Error("Missing NEXT_PUBLIC_REPUTATION_CONTRACT_ID");
    }
    if (!ESCROW_CONTRACT_ID) {
      throw new Error("Missing NEXT_PUBLIC_ESCROW_CONTRACT_ID");
    }

    const server = new rpc.Server(RPC_URL);
    const contract = new Contract(REPUTATION_CONTRACT_ID);
    const account = await server.getAccount(params.reviewerPublicKey);

    const stakeWeight = BigInt(params.stakeWeightStroops);
    const jobId = BigInt(params.jobIdOnChain);

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          "submit_review",
          nativeToScVal(Address.fromString(ESCROW_CONTRACT_ID), {
            type: "address",
          }),
          nativeToScVal(Address.fromString(params.reviewerPublicKey), {
            type: "address",
          }),
          nativeToScVal(Address.fromString(params.revieweePublicKey), {
            type: "address",
          }),
          nativeToScVal(jobId, { type: "u64" }),
          nativeToScVal(params.rating, { type: "u32" }),
          nativeToScVal(params.comment),
          nativeToScVal(stakeWeight, { type: "i128" }),
        ),
      )
      .setTimeout(30)
      .build();

    return tx.toXDR();
  }
}