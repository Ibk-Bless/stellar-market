import { PrismaClient } from "@prisma/client";
import { Keypair, TransactionBuilder, rpc, nativeToScVal, Contract, BASE_FEE } from "@stellar/stellar-sdk";
import { config } from "../config";
import { logger } from "../lib/logger";
import { NotificationService } from "../services/notification.service";
import { ContractService } from "../services/contract.service";

const prisma = new PrismaClient();
const ONE_HOUR_MS = 60 * 60 * 1000;

async function checkEscrowTtls(): Promise<void> {
  logger.info("[EscrowTtlJob] Checking escrow TTLs...");
  
  try {
    const activeJobs = await prisma.job.findMany({
      where: {
        escrowStatus: "FUNDED",
        contractJobId: { not: null },
        status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] },
      },
      select: {
        id: true,
        title: true,
        contractJobId: true,
        clientId: true,
      },
    });

    logger.info({ count: activeJobs.length }, `[EscrowTtlJob] Found ${activeJobs.length} active jobs to check`);

    for (const job of activeJobs) {
      if (!job.contractJobId) continue;
      
      const ttlInfo = await ContractService.getEscrowTtl(job.contractJobId);
      if (!ttlInfo) {
        logger.warn({ jobId: job.id, contractJobId: job.contractJobId }, "[EscrowTtlJob] Escrow not found on-chain");
        continue;
      }

      const { daysRemaining, currentLedger, expiryLedger } = ttlInfo;
      logger.info(
        { jobId: job.id, daysRemaining, currentLedger, expiryLedger },
        `[EscrowTtlJob] Escrow status: ${daysRemaining} days remaining`
      );

      if (daysRemaining < 14) {
        const lastAlerts = await prisma.notification.findMany({
          where: {
            userId: job.clientId,
            type: "ESCROW_TTL_WARNING" as any,
            createdAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
            },
          },
        });

        const alreadyAlerted = lastAlerts.some(alert => {
          const meta = alert.metadata as any;
          return meta && meta.jobId === job.id;
        });

        if (!alreadyAlerted) {
          await NotificationService.sendNotification({
            userId: job.clientId,
            type: "ESCROW_TTL_WARNING" as any,
            title: "Escrow Expiry Warning",
            message: `The escrow for your job "${job.title}" has ${daysRemaining} days remaining before archival.`,
            metadata: { jobId: job.id, daysRemaining },
          });
          logger.info({ jobId: job.id }, "[EscrowTtlJob] Sent escrow expiry warning notification to client");
        }
      }

      if (daysRemaining < 7) {
        if (!config.stellar.keeperSecretKey) {
          logger.warn(
            { jobId: job.id, daysRemaining },
            "[EscrowTtlJob] Escrow within 7 days of expiry but no keeperSecretKey configured to extend it."
          );
          continue;
        }

        try {
          const keeperKeypair = Keypair.fromSecret(config.stellar.keeperSecretKey);
          const server = new rpc.Server(config.stellar.rpcUrl);
          
          logger.info(
            { jobId: job.id, daysRemaining },
            `[EscrowTtlJob] Proactively extending escrow TTL (days remaining: ${daysRemaining})`
          );

          const account = await server.getAccount(keeperKeypair.publicKey());
          const contract = new Contract(config.stellar.escrowContractId);

          const tx = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: config.stellar.networkPassphrase,
          })
            .addOperation(
              contract.call(
                "extend_escrow_ttl",
                nativeToScVal(BigInt(job.contractJobId)),
              ),
            )
            .setTimeout(0)
            .build();

          tx.sign(keeperKeypair);

          const response = await server.sendTransaction(tx);
          if (response.status === "ERROR") {
            logger.error({ jobId: job.id, response }, "[EscrowTtlJob] Failed to submit extend_escrow_ttl transaction");
          } else {
            logger.info({ jobId: job.id, txHash: response.hash }, "[EscrowTtlJob] Submitted extend_escrow_ttl transaction");
          }
        } catch (err) {
          logger.error({ err, jobId: job.id }, "[EscrowTtlJob] Failed to extend escrow TTL");
        }
      }
    }
  } catch (error) {
    logger.error({ err: error }, "[EscrowTtlJob] Error during checking escrow TTLs");
  }
}

export function startEscrowTtlJob(): void {
  checkEscrowTtls();
  setInterval(checkEscrowTtls, ONE_HOUR_MS);
  logger.info("[EscrowTtlJob] Scheduled — runs every hour");
}

export { checkEscrowTtls };
