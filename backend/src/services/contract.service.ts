import {
  Address,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
  nativeToScVal,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import type { PrismaClient } from "@prisma/client";
import { MilestoneStatus } from "@prisma/client";
import { config } from "../config";
import { getRequestId } from "../lib/request-context";
import { logger } from "../lib/logger";

const networkPassphrase = config.stellar.networkPassphrase;
const contractId = config.stellar.escrowContractId;
const READONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const STROOPS_PER_XLM = 10_000_000n;

function getRpcServer(): rpc.Server {
  const requestId = getRequestId();

  return new rpc.Server(config.stellar.rpcUrl, {
    headers: requestId ? { "X-Request-ID": requestId } : undefined,
  });
}

export type RevisionProposalView = {
  proposer: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  newTotalStroops: string;
  milestones: Array<{
    id: number;
    description: string;
    amountStroops: string;
    deadline: number;
    status: string;
  }>;
  createdAt: number;
};

/** View of the on-chain exchange-rate parity snapshot recorded at funding time. */
export type RateSnapshotView = {
  /** TWAP of the funding token in XLM stroops, scaled by 1e7. */
  twapPriceStroops: string;
  /** Number of ledger samples the TWAP averaged over. */
  samples: number;
  /** Agreed job value in XLM stroops. */
  agreedValueStroops: string;
  /** Computed value of the deposit in XLM stroops at funding time. */
  depositedValueStroops: string;
  /** Tolerated downside deviation in basis points. */
  maxSlippageBps: number;
  /** Ledger sequence at which the snapshot was taken. */
  ledger: number;
};

export class ContractSimulationError extends Error {
  constructor(public readonly simulationError: string) {
    super(`Contract simulation failed: ${simulationError}`);
    this.name = "ContractSimulationError";
  }
}

export class ContractService {
  /**
   * Builds an un-signed transaction XDR for creating a job on-chain.
   */
  static async buildCreateJobTx(
    clientPublicKey: string,
    freelancerPublicKey: string,
    tokenContractId: string,
    milestones: { description: string; amount: number; deadline: number }[],
    jobDeadline: number
  ) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const sourceAccount = await server.getLatestLedger(); // Dummy to get ledger, we need account seq
    // Note: To build a tx, we need the account's current sequence number.
    // The frontend can do this, but if the backend does it, it needs the public key.
    
    const account = await server.getAccount(clientPublicKey);
    
    const scMilestones = milestones.map(m => {
      return nativeToScVal([
        m.description,
        BigInt(Math.floor(m.amount * 10_000_000)), // Assuming 7 decimals for XLM/Token
        BigInt(m.deadline)
      ]);
    });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "create_job",
        new Address(clientPublicKey).toScVal(),
        new Address(freelancerPublicKey).toScVal(),
        new Address(tokenContractId).toScVal(),
        nativeToScVal(scMilestones, { type: "vec" }),
        nativeToScVal(BigInt(jobDeadline))
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for submitting a milestone.
   */
  static async buildSubmitMilestoneTx(
    freelancerPublicKey: string,
    jobId: string,
    milestoneId: number,
  ) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(freelancerPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "submit_milestone",
          nativeToScVal(BigInt(jobId)),
          nativeToScVal(milestoneId, { type: "u32" }),
          new Address(freelancerPublicKey).toScVal(),
        ),
      )
      .setTimeout(0)
      .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for funding a job.
   *
   * `agreedValueStroops` is the off-chain-agreed job value expressed in XLM
   * stroops; the contract validates the deposit against a DEX TWAP and rejects
   * under-value funding. Pass `0n` to bypass the oracle check (native-XLM jobs
   * and the legacy migration path). `maxSlippageBps` is the tolerated downside
   * deviation in basis points (e.g. 200 = 2%).
   */
  static async buildFundJobTx(
    clientPublicKey: string,
    jobId: string,
    agreedValueStroops: bigint = 0n,
    maxSlippageBps: number = 0,
  ) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(clientPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "fund_job",
        nativeToScVal(BigInt(jobId)),
        new Address(clientPublicKey).toScVal(),
        nativeToScVal(agreedValueStroops, { type: "i128" }),
        nativeToScVal(maxSlippageBps, { type: "u32" }),
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  /**
   * Reads the stored exchange-rate parity snapshot for a job, or `null` if the
   * job was funded without oracle validation (legacy / XLM-only).
   */
  static async getRateSnapshot(onChainJobId: string): Promise<RateSnapshotView | null> {
    const contract = new Contract(contractId);
    const native = await this.simulateContractRead(
      contract.call("get_rate_snapshot", nativeToScVal(BigInt(onChainJobId))),
    );
    if (native === null || native === undefined) {
      return null;
    }
    const snap = native as {
      twap_price: bigint | number;
      samples: number;
      agreed_value_stroops: bigint | number;
      deposited_value: bigint | number;
      max_slippage_bps: number;
      ledger: number;
    };
    return {
      twapPriceStroops: snap.twap_price.toString(),
      samples: Number(snap.samples),
      agreedValueStroops: snap.agreed_value_stroops.toString(),
      depositedValueStroops: snap.deposited_value.toString(),
      maxSlippageBps: Number(snap.max_slippage_bps),
      ledger: Number(snap.ledger),
    };
  }

  /**
   * Simulate `fund_job` so an exchange-rate parity failure can be surfaced as a
   * structured API error *before* the client signs. Returns `{ ok: true }` when
   * the deposit would pass, or a typed reason when it would be rejected.
   *
   * Network/simulation issues unrelated to parity are reported as `UNKNOWN` so
   * callers can fall back to building the XDR rather than blocking funding.
   */
  static async simulateFundJob(
    clientPublicKey: string,
    onChainJobId: string,
    agreedValueStroops: bigint,
    maxSlippageBps: number,
  ): Promise<
    | { ok: true }
    | { ok: false; reason: "INSUFFICIENT_VALUE" | "ORACLE_UNAVAILABLE" | "UNKNOWN"; detail?: string }
  > {
    const contract = new Contract(contractId);
    const operation = contract.call(
      "fund_job",
      nativeToScVal(BigInt(onChainJobId)),
      new Address(clientPublicKey).toScVal(),
      nativeToScVal(agreedValueStroops, { type: "i128" }),
      nativeToScVal(maxSlippageBps, { type: "u32" }),
    );

    try {
      await this.simulateContractRead(operation);
      return { ok: true };
    } catch (err) {
      const detail = err instanceof ContractSimulationError ? err.simulationError : String(err);
      // EscrowError discriminants: InsufficientValue = 41, OracleUnavailable = 42.
      if (/#41\b/.test(detail)) return { ok: false, reason: "INSUFFICIENT_VALUE", detail };
      if (/#42\b/.test(detail)) return { ok: false, reason: "ORACLE_UNAVAILABLE", detail };
      return { ok: false, reason: "UNKNOWN", detail };
    }
  }

  /**
   * Builds an un-signed transaction XDR for approving a milestone.
   */
  static async buildApproveMilestoneTx(clientPublicKey: string, jobId: string, milestoneId: number) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(clientPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "approve_milestone",
        nativeToScVal(BigInt(jobId)),
        nativeToScVal(milestoneId, { type: "u32" }),
        new Address(clientPublicKey).toScVal()
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for cancelling a funded or in-progress job.
   */
  static async buildCancelJobTx(clientPublicKey: string, jobId: string) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(clientPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "cancel_job",
          nativeToScVal(BigInt(jobId)),
          new Address(clientPublicKey).toScVal(),
        ),
      )
      .setTimeout(0)
      .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for claiming a deadline-based refund.
   */
  static async buildClaimRefundTx(clientPublicKey: string, jobId: string) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(clientPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "claim_refund",
          nativeToScVal(BigInt(jobId)),
          new Address(clientPublicKey).toScVal(),
        ),
      )
      .setTimeout(0)
      .build();

    return tx.toXDR();
  }

  /**
   * Verification function to check transaction status on-chain.
   */
  static async verifyTransaction(hash: string) {
    const server = getRpcServer();
    const response = await server.getTransaction(hash);
    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        // Extract results if needed
        return { success: true, result: response.resultXdr };
    }
    return { success: false, error: response.status };
  }

  /**
   * Builds an un-signed transaction XDR for raising a dispute.
   */
  static async buildRaiseDisputeTx(
    initiatorPublicKey: string,
    jobId: number,
    clientPublicKey: string,
    freelancerPublicKey: string,
    reason: string,
    minVotes: number
  ) {
    const server = getRpcServer();
    const contract = new Contract(config.stellar.disputeContractId);
    const account = await server.getAccount(initiatorPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "raise_dispute",
        nativeToScVal(BigInt(jobId)),
        new Address(clientPublicKey).toScVal(),
        new Address(freelancerPublicKey).toScVal(),
        new Address(initiatorPublicKey).toScVal(),
        nativeToScVal(reason),
        nativeToScVal(minVotes, { type: "u32" })
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for casting a vote on a dispute.
   */
  static async buildCastVoteTx(
    voterPublicKey: string,
    disputeId: number,
    choice: number, // 0 for Client, 1 for Freelancer (based on enum in contract)
    reason: string
  ) {
    const server = getRpcServer();
    const contract = new Contract(config.stellar.disputeContractId);
    const account = await server.getAccount(voterPublicKey);

    // Soroban enums are typically represented as symbols or integers depending on the SDK mapping
    // Here we'll map 0 -> 'Client', 1 -> 'Freelancer' for the VoteChoice enum
    const choiceScVal = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(choice === 0 ? "Client" : "Freelancer")
    ]);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "cast_vote",
        nativeToScVal(BigInt(disputeId)),
        new Address(voterPublicKey).toScVal(),
        xdr.ScVal.scvSymbol(choice === 0 ? "Client" : "Freelancer"),
        nativeToScVal(reason)
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for extending a milestone deadline.
   */
  static async buildExtendDeadlineTx(
    clientPublicKey: string,
    jobId: string,
    milestoneId: number,
    newDeadline: number,
  ) {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(clientPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "extend_deadline",
        nativeToScVal(BigInt(jobId)),
        nativeToScVal(milestoneId, { type: "u32" }),
        nativeToScVal(BigInt(newDeadline))
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  /**
   * Builds an un-signed transaction XDR for resolving a dispute.
   */
  static async buildResolveDisputeTx(
    callerPublicKey: string,
    disputeId: number,
  ) {
    const server = getRpcServer();
    const contract = new Contract(config.stellar.disputeContractId);
    const account = await server.getAccount(callerPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
    .addOperation(
      contract.call(
        "resolve_dispute",
        nativeToScVal(BigInt(disputeId)),
        new Address(config.stellar.escrowContractId).toScVal()
      )
    )
    .setTimeout(0)
    .build();

    return tx.toXDR();
  }

  private static async buildReadonlySimTx(
    operation: xdr.Operation
  ): Promise<ReturnType<TransactionBuilder["build"]>> {
    const server = getRpcServer();
    const sourceAccount = await server.getAccount(READONLY_SOURCE).catch(() => {
      return {
        accountId: () => READONLY_SOURCE,
        sequenceNumber: () => "0",
        incrementSequenceNumber: () => {},
      } as any;
    });
    return new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(0)
      .build();
  }

  static async simulateContractRead(operation: xdr.Operation): Promise<unknown> {
    const server = getRpcServer();
    const tx = await this.buildReadonlySimTx(operation);
    const simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new ContractSimulationError(simulation.error);
    }
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      throw new ContractSimulationError("Simulation did not succeed — state restore may be required");
    }
    return scValToNative(simulation.result!.retval);
  }

  /**
   * Fetches the on-chain status of a job from the escrow contract.
   */
  static async getOnChainJobStatus(onChainJobId: string): Promise<string> {
    try {
      const contract = new Contract(contractId);
      const native = await this.simulateContractRead(
        contract.call("get_job", nativeToScVal(BigInt(onChainJobId)))
      );
      const job = native as { status: string | string[] };
      const rawStatus = Array.isArray(job.status) ? job.status[0] : job.status;
      const status = String(rawStatus ?? "").toUpperCase();

      switch (status) {
        case "CREATED":
          return "UNFUNDED";
        case "FUNDED":
        case "INPROGRESS":
          return "FUNDED";
        case "COMPLETED":
          return "COMPLETED";
        case "DISPUTED":
          return "DISPUTED";
        case "CANCELLED":
          return "CANCELLED";
        default:
          return status;
      }
    } catch (error) {
      logger.error({ err: error, onChainJobId }, "Error fetching on-chain status for job");
      throw error;
    }
  }

  private static unwrapSorobanOption<T>(val: unknown): T | null {
    if (val === null || val === undefined) return null;
    if (Array.isArray(val)) {
      if (val.length === 0) return null;
      const tag = val[0];
      if (tag === "None" || tag === 0) return null;
      if ((tag === "Some" || tag === 1) && val.length >= 2) return val[1] as T;
      return val as unknown as T;
    }
    if (typeof val === "object" && val !== null) {
      const o = val as Record<string, unknown>;
      if ("Some" in o && o.Some !== undefined) return o.Some as T;
      if ("None" in o) return null;
    }
    return val as T;
  }

  private static normalizeProposalStatus(
    s: unknown
  ): "PENDING" | "ACCEPTED" | "REJECTED" {
    const raw = Array.isArray(s) ? s[0] : s;
    const u = String(raw ?? "").toUpperCase();
    if (u === "PENDING") return "PENDING";
    if (u === "ACCEPTED") return "ACCEPTED";
    if (u === "REJECTED") return "REJECTED";
    return "PENDING";
  }

  private static milestoneToProposeScVal(
    index: number,
    description: string,
    amountStroops: bigint,
    deadlineUnix: bigint
  ) {
    return nativeToScVal({
      amount: amountStroops,
      deadline: deadlineUnix,
      description,
      id: nativeToScVal(index, { type: "u32" }),
      status: [nativeToScVal("Pending", { type: "symbol" })],
    });
  }

  /**
   * Builds an un-signed transaction XDR for proposing a milestone/budget revision.
   */
  static async buildProposeRevisionTx(
    callerPublicKey: string,
    onChainJobId: string,
    milestones: { description: string; amount: number; deadlineUnix: number }[]
  ): Promise<string> {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(callerPublicKey);
    const scMilestones = milestones.map((m, i) =>
      this.milestoneToProposeScVal(
        i,
        m.description,
        BigInt(Math.floor(m.amount * Number(STROOPS_PER_XLM))),
        BigInt(m.deadlineUnix)
      )
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "propose_revision",
          new Address(callerPublicKey).toScVal(),
          nativeToScVal(BigInt(onChainJobId)),
          nativeToScVal(scMilestones, { type: "vec" })
        )
      )
      .setTimeout(0)
      .build();
    return tx.toXDR();
  }

  static async buildAcceptRevisionTx(
    callerPublicKey: string,
    onChainJobId: string
  ): Promise<string> {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(callerPublicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "accept_revision",
          new Address(callerPublicKey).toScVal(),
          nativeToScVal(BigInt(onChainJobId))
        )
      )
      .setTimeout(0)
      .build();
    return tx.toXDR();
  }

  static async buildRejectRevisionTx(
    callerPublicKey: string,
    onChainJobId: string
  ): Promise<string> {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(callerPublicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "reject_revision",
          new Address(callerPublicKey).toScVal(),
          nativeToScVal(BigInt(onChainJobId))
        )
      )
      .setTimeout(0)
      .build();
    return tx.toXDR();
  }

  private static parseRevisionProposalRaw(raw: Record<string, unknown>): RevisionProposalView {
    const ms = (raw.new_milestones ?? raw.newMilestones) as unknown[] | undefined;
    const newTotal = raw.new_total ?? raw.newTotal;
    const created = raw.created_at ?? raw.createdAt;
    return {
      proposer: String(raw.proposer ?? ""),
      status: this.normalizeProposalStatus(raw.status),
      newTotalStroops: String(
        typeof newTotal === "bigint" ? newTotal : BigInt(Number(newTotal ?? 0))
      ),
      milestones: (ms ?? []).map((entry) => {
        const m = entry as Record<string, unknown>;
        const st = m.status;
        const statusStr = Array.isArray(st) ? String(st[0] ?? "") : String(st ?? "");
        return {
          id: Number(m.id ?? 0),
          description: String(m.description ?? ""),
          amountStroops: String(
            typeof m.amount === "bigint" ? m.amount : BigInt(Number(m.amount ?? 0))
          ),
          deadline: Number(
            typeof m.deadline === "bigint" ? m.deadline : BigInt(Number(m.deadline ?? 0))
          ),
          status: statusStr,
        };
      }),
      createdAt: Number(
        typeof created === "bigint" ? created : BigInt(Number(created ?? 0))
      ),
    };
  }

  /**
   * Reads the stored revision proposal for a job from chain (simulation).
   */
  static async getRevisionProposal(
    onChainJobId: string
  ): Promise<RevisionProposalView | null> {
    try {
      const contract = new Contract(contractId);
      const native = await this.simulateContractRead(
        contract.call(
          "get_revision_proposal",
          nativeToScVal(BigInt(onChainJobId))
        )
      );
      let raw = this.unwrapSorobanOption<Record<string, unknown>>(native);
      if (
        !raw &&
        native &&
        typeof native === "object" &&
        !Array.isArray(native) &&
        "proposer" in native
      ) {
        raw = native as Record<string, unknown>;
      }
      if (!raw) return null;
      return this.parseRevisionProposalRaw(raw);
    } catch (error) {
      logger.warn(
        { err: error, onChainJobId },
        "get_revision_proposal simulation failed",
      );
      return null;
    }
  }

  private static mapChainMilestoneStatus(chainStatus: unknown): MilestoneStatus {
    const raw = Array.isArray(chainStatus) ? chainStatus[0] : chainStatus;
    const u = String(raw ?? "").toUpperCase();
    if (u === "IN_PROGRESS" || u === "INPROGRESS") return MilestoneStatus.IN_PROGRESS;
    if (u === "SUBMITTED") return MilestoneStatus.SUBMITTED;
    if (u === "APPROVED") return MilestoneStatus.APPROVED;
    if (u === "REJECTED") return MilestoneStatus.REJECTED;
    return MilestoneStatus.PENDING;
  }

  /**
   * Overwrites local job budget and milestones from on-chain job state (after revision accept).
   */
  static async syncJobFromChain(
    prisma: PrismaClient,
    jobId: string,
    onChainJobId: string
  ): Promise<void> {
    const contract = new Contract(contractId);
    const native = await this.simulateContractRead(
      contract.call("get_job", nativeToScVal(BigInt(onChainJobId)))
    );
    const job = native as {
      total_amount: bigint | number;
      milestones: Array<{
        id: number;
        description: string;
        amount: bigint | number;
        status: unknown;
        deadline: bigint | number;
      }>;
    };
    const totalStroops =
      typeof job.total_amount === "bigint"
        ? job.total_amount
        : BigInt(Math.floor(Number(job.total_amount)));
    const budgetXlm = Number(totalStroops) / Number(STROOPS_PER_XLM);

    await prisma.$transaction(async (tx: any) => {
      await tx.milestone.deleteMany({ where: { jobId } });
      const list = job.milestones ?? [];
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const amountStroops =
          typeof m.amount === "bigint" ? m.amount : BigInt(Math.floor(Number(m.amount)));
        const deadlineSec =
          typeof m.deadline === "bigint" ? m.deadline : BigInt(Math.floor(Number(m.deadline)));
        await tx.milestone.create({
          data: {
            jobId,
            title: String(m.description).slice(0, 200) || `Milestone ${i + 1}`,
            description: String(m.description ?? ""),
            amount: Number(amountStroops) / Number(STROOPS_PER_XLM),
            status: this.mapChainMilestoneStatus(m.status),
            order: i,
            onChainIndex: Number(m.id ?? i),
            contractDeadline: new Date(Number(deadlineSec) * 1000),
          },
        });
      }
      await tx.job.update({
        where: { id: jobId },
        data: { budget: budgetXlm },
      });
    });
  }

  /**
   * Fetches current ledger, expiry ledger, and days remaining for an escrow.
   */
  static async getEscrowTtl(onChainJobId: string): Promise<{
    currentLedger: number;
    expiryLedger: number;
    daysRemaining: number;
  } | null> {
    try {
      const server = getRpcServer();
      const keyScVal = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Job"),
        xdr.ScVal.scvU64(new xdr.Uint64(BigInt(onChainJobId)))
      ]);
      
      const ledgerKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(contractId).toScAddress(),
          key: keyScVal,
          durability: xdr.ContractDataDurability.persistent(),
        })
      );

      const response = await server.getLedgerEntries(ledgerKey);
      if (!response.entries || response.entries.length === 0) {
        return null;
      }
      
      const entry = response.entries[0];
      const currentLedger = response.latestLedger;
      const expiryLedger = entry.liveUntilLedgerSeq ?? 0;
      
      const ledgersRemaining = Math.max(0, expiryLedger - currentLedger);
      const daysRemaining = (ledgersRemaining * 5) / (24 * 60 * 60);
      
      return {
        currentLedger,
        expiryLedger,
        daysRemaining: Number(daysRemaining.toFixed(2)),
      };
    } catch (error) {
      logger.error({ err: error, onChainJobId }, "Error fetching escrow TTL");
      return null;
    }
  }

  /**
   * Builds an unsigned transaction XDR to extend escrow TTL.
   */
  static async buildExtendEscrowTtlTx(callerPublicKey: string, onChainJobId: string): Promise<string> {
    const server = getRpcServer();
    const contract = new Contract(contractId);
    const account = await server.getAccount(callerPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "extend_escrow_ttl",
          nativeToScVal(BigInt(onChainJobId)),
        ),
      )
      .setTimeout(0)
      .build();

    return tx.toXDR();
  }
}
