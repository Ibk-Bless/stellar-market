import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { rpc } from "@stellar/stellar-sdk";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validation";
import { logger } from "../lib/logger";
import { config } from "../config";

const router = Router();
const prisma = new PrismaClient();
const rpcServer = new rpc.Server(config.stellar.rpcUrl);

// Validation schemas
const createTransactionSchema = {
  body: z.object({
    jobId: z.string(),
    milestoneId: z.string().optional(),
    fromAddress: z.string(),
    toAddress: z.string(),
    amount: z.number().positive(),
    tokenAddress: z.string(),
    txHash: z.string(),
    type: z.enum(["DEPOSIT", "RELEASE", "REFUND", "DISPUTE_PAYOUT"]),
  }),
};

const listTransactionsSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    type: z.enum(["DEPOSIT", "RELEASE", "REFUND", "DISPUTE_PAYOUT"]).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    minAmount: z.coerce.number().optional(),
    maxAmount: z.coerce.number().optional(),
  }),
};

const jobTransactionsSchema = {
  params: z.object({
    jobId: z.string(),
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
};

const txHashSchema = {
  params: z.object({
    txHash: z.string(),
  }),
};

const preRegisterSchema = {
  body: z.object({
    txHash: z.string().min(1),
    type: z.enum(["DEPOSIT", "RELEASE", "REFUND", "DISPUTE_PAYOUT"]),
    jobId: z.string().optional(),
    milestoneId: z.string().optional(),
    maxLedger: z.number().int().positive().optional(),
    fromAddress: z.string().optional(),
    toAddress: z.string().optional(),
    amount: z.number().positive().optional(),
    tokenAddress: z.string().optional(),
  }),
};

/**
 * POST /api/transactions/pre-register
 * Idempotently register a transaction hash before broadcasting to Horizon.
 * If the txHash already exists the existing record is returned unchanged.
 * This gives the backend a record to resolve against even if the HTTP
 * response from Horizon is never received.
 */
router.post(
  "/pre-register",
  authenticate,
  validate(preRegisterSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        txHash,
        type,
        jobId,
        milestoneId,
        maxLedger,
        fromAddress,
        toAddress,
        amount,
        tokenAddress,
      } = req.body;

      const record = await prisma.transaction.upsert({
        where: { txHash },
        update: {},
        create: {
          txHash,
          type,
          status: "PENDING",
          jobId: jobId ?? null,
          milestoneId: milestoneId ?? null,
          maxLedger: maxLedger ?? null,
          fromAddress: fromAddress ?? null,
          toAddress: toAddress ?? null,
          amount: amount ?? null,
          tokenAddress: tokenAddress ?? null,
        },
        select: { id: true, txHash: true, status: true, createdAt: true },
      });

      logger.info({ txHash, type }, "[Transaction] Pre-registered");
      return res.status(200).json(record);
    } catch (error) {
      logger.error({ err: error }, "Error pre-registering transaction");
      return res.status(500).json({ error: "Failed to pre-register transaction" });
    }
  },
);

/**
 * GET /api/transactions/:txHash/status
 * Returns the resolved status of a transaction.
 * For PENDING records this queries the Soroban RPC live and syncs the result.
 * Callers that receive { status: "EXPIRED", canRetry: true } should build a
 * new transaction with a fresh sequence number and ask the user to re-sign.
 */
router.get(
  "/:txHash/status",
  validate({ params: z.object({ txHash: z.string() }) }),
  async (req: AuthRequest, res: Response) => {
    try {
      const txHash = req.params.txHash as string;

      const record = await prisma.transaction.findUnique({
        where: { txHash },
        select: { id: true, status: true, maxLedger: true, confirmedLedger: true },
      });

      if (!record) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      if (record.status === "SUCCESS") {
        return res.json({ status: "SUCCESS", ledger: record.confirmedLedger });
      }

      if (record.status === "FAILED") {
        return res.json({ status: "FAILED", canRetry: false });
      }

      if (record.status === "EXPIRED") {
        return res.json({ status: "EXPIRED", canRetry: true });
      }

      // PENDING — query Soroban RPC for live status
      try {
        const rpcResult = await rpcServer.getTransaction(txHash);

        if (rpcResult.status === "SUCCESS") {
          const confirmedLedger = (rpcResult as any).ledger ?? null;
          await prisma.transaction.update({
            where: { id: record.id },
            data: { status: "SUCCESS", confirmedLedger },
          });
          return res.json({ status: "SUCCESS", ledger: confirmedLedger });
        }

        if (rpcResult.status === "FAILED") {
          await prisma.transaction.update({
            where: { id: record.id },
            data: { status: "FAILED" },
          });
          return res.json({ status: "FAILED", canRetry: false });
        }

        // NOT_FOUND — check whether the transaction's timeBounds deadline has
        // passed. `maxLedger` stores `tx.timeBounds.maxTime`, a Unix timestamp
        // in seconds (set in submitWithPreRegistration), not a ledger sequence
        // number — it must be compared against wall-clock time, not against
        // `getLatestLedger().sequence` (which is orders of magnitude smaller
        // and would never trip this check).
        if (record.maxLedger != null) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          if (nowSeconds > record.maxLedger) {
            await prisma.transaction.update({
              where: { id: record.id },
              data: { status: "EXPIRED" },
            });
            return res.json({ status: "EXPIRED", canRetry: true });
          }
        }
      } catch (rpcErr) {
        logger.warn({ err: rpcErr, txHash }, "[Transaction] RPC status check failed — returning PENDING");
      }

      return res.json({ status: "PENDING" });
    } catch (error) {
      logger.error({ err: error }, "Error fetching transaction status");
      return res.status(500).json({ error: "Failed to fetch transaction status" });
    }
  },
);

/**
 * POST /api/transactions
 * Record a transaction after successful on-chain tx
 */
router.post(
  "/",
  authenticate,
  validate(createTransactionSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        jobId,
        milestoneId,
        fromAddress,
        toAddress,
        amount,
        tokenAddress,
        txHash,
        type,
      } = req.body;

      // Verify job exists
      const job = await prisma.job.findUnique({
        where: { id: jobId },
      });

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      // Verify milestone exists if provided
      if (milestoneId) {
        const milestone = await prisma.milestone.findUnique({
          where: { id: milestoneId },
        });

        if (!milestone || milestone.jobId !== jobId) {
          return res
            .status(404)
            .json({ error: "Milestone not found or does not belong to job" });
        }
      }

      // Upsert: if a PENDING pre-registration exists for this txHash, promote it to
      // SUCCESS with full details. Otherwise create a new SUCCESS record.
      const transaction = await prisma.transaction.upsert({
        where: { txHash },
        update: {
          jobId,
          milestoneId: milestoneId ?? null,
          fromAddress,
          toAddress,
          amount,
          tokenAddress,
          type,
          status: "SUCCESS",
        },
        create: {
          jobId,
          milestoneId: milestoneId ?? null,
          fromAddress,
          toAddress,
          amount,
          tokenAddress,
          txHash,
          type,
          status: "SUCCESS",
        },
        include: {
          job: {
            select: {
              id: true,
              title: true,
            },
          },
          milestone: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      res.status(201).json(transaction);
    } catch (error) {
      logger.error({ err: error }, "Error creating transaction");
      res.status(500).json({ error: "Failed to create transaction" });
    }
  },
);

/**
 * GET /api/transactions
 * List transactions for authenticated user (paginated and filtered)
 */
router.get(
  "/",
  authenticate,
  validate(listTransactionsSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const {
        page = 1,
        limit = 20,
        type,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
      } = req.query;

      const skip = (Number(page) - 1) * Number(limit);

      // Build filter
      const where: any = {
        OR: [
          { fromAddress: user.walletAddress },
          { toAddress: user.walletAddress },
        ],
      };

      if (type) {
        where.type = type;
      }

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = new Date(dateFrom as string);
        }
        if (dateTo) {
          where.createdAt.lte = new Date(dateTo as string);
        }
      }

      if (minAmount || maxAmount) {
        where.amount = {};
        if (minAmount) {
          where.amount.gte = minAmount;
        }
        if (maxAmount) {
          where.amount.lte = maxAmount;
        }
      }

      // Get transactions
      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: "desc" },
          include: {
            job: {
              select: {
                id: true,
                title: true,
              },
            },
            milestone: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        }),
        prisma.transaction.count({ where }),
      ]);

      res.json({
        transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching transactions");
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  },
);

/**
 * GET /api/transactions/history
 * Get comprehensive on-chain transaction history for authenticated user
 * Enhanced version with better analytics and filtering
 */
router.get(
  "/history",
  authenticate,
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      type: z
        .enum(["DEPOSIT", "RELEASE", "REFUND", "DISPUTE_PAYOUT"])
        .optional(),
      direction: z.enum(["incoming", "outgoing", "all"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      minAmount: z.coerce.number().optional(),
      maxAmount: z.coerce.number().optional(),
      jobId: z.string().optional(),
      tokenAddress: z.string().optional(),
      includeAnalytics: z.coerce.boolean().default(false),
    }),
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const {
        page = 1,
        limit = 20,
        type,
        direction = "all",
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        jobId,
        tokenAddress,
        includeAnalytics = false,
      } = req.query as any;

      const skip = (Number(page) - 1) * Number(limit);

      // Build base filter
      const where: any = {};

      // Filter by direction (incoming/outgoing)
      if (direction === "incoming") {
        where.toAddress = user.walletAddress;
      } else if (direction === "outgoing") {
        where.fromAddress = user.walletAddress;
      } else {
        // All transactions (incoming or outgoing)
        where.OR = [
          { fromAddress: user.walletAddress },
          { toAddress: user.walletAddress },
        ];
      }

      // Additional filters
      if (type) {
        where.type = type;
      }

      if (jobId) {
        where.jobId = jobId;
      }

      if (tokenAddress) {
        where.tokenAddress = tokenAddress;
      }

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = new Date(dateFrom as string);
        }
        if (dateTo) {
          where.createdAt.lte = new Date(dateTo as string);
        }
      }

      if (minAmount || maxAmount) {
        where.amount = {};
        if (minAmount) {
          where.amount.gte = Number(minAmount);
        }
        if (maxAmount) {
          where.amount.lte = Number(maxAmount);
        }
      }

      // Get transactions with enhanced data
      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: "desc" },
          include: {
            job: {
              select: {
                id: true,
                title: true,
                status: true,
                clientId: true,
                freelancerId: true,
                client: {
                  select: {
                    id: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
                freelancer: {
                  select: {
                    id: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            milestone: {
              select: {
                id: true,
                title: true,
                order: true,
                status: true,
              },
            },
            from: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
            to: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        }),
        prisma.transaction.count({ where }),
      ]);

      // Enhance transactions with direction and role information
      const enhancedTransactions = transactions.map((tx) => {
        const isIncoming = tx.toAddress === user.walletAddress;
        const isOutgoing = tx.fromAddress === user.walletAddress;

        let userRole = "unknown";
        if (tx.job?.clientId === req.userId) {
          userRole = "client";
        } else if (tx.job?.freelancerId === req.userId) {
          userRole = "freelancer";
        }

        return {
          ...tx,
          direction: isIncoming ? "incoming" : "outgoing",
          userRole,
          counterparty: isIncoming ? tx.from : tx.to,
          amountFormatted: {
            value: tx.amount,
            direction: isIncoming ? "+" : "-",
            displayAmount: isIncoming ? `+${tx.amount}` : `-${tx.amount}`,
          },
        };
      });

      const response: any = {
        transactions: enhancedTransactions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      };

      // Include analytics if requested
      if (includeAnalytics) {
        const analyticsWhere = { ...where };
        delete analyticsWhere.OR; // Remove OR for analytics to get separate incoming/outgoing

        const [
          totalIncoming,
          totalOutgoing,
          transactionsByType,
          transactionsByMonth,
          uniqueCounterparties,
        ] = await Promise.all([
          // Total incoming
          prisma.transaction.aggregate({
            where: {
              ...analyticsWhere,
              toAddress: user.walletAddress,
            },
            _sum: { amount: true },
            _count: true,
          }),
          // Total outgoing
          prisma.transaction.aggregate({
            where: {
              ...analyticsWhere,
              fromAddress: user.walletAddress,
            },
            _sum: { amount: true },
            _count: true,
          }),
          // Transactions by type
          prisma.transaction.groupBy({
            by: ["type"],
            where,
            _sum: { amount: true },
            _count: { type: true },
          }),
          // Transactions by month (last 12 months)
          prisma.$queryRaw`
            SELECT 
              DATE_TRUNC('month', "createdAt") as month,
              COUNT(*)::int as count,
              SUM(amount)::float as total_amount,
              SUM(CASE WHEN "toAddress" = ${user.walletAddress} THEN amount ELSE 0 END)::float as incoming_amount,
              SUM(CASE WHEN "fromAddress" = ${user.walletAddress} THEN amount ELSE 0 END)::float as outgoing_amount
            FROM "Transaction"
            WHERE ("fromAddress" = ${user.walletAddress} OR "toAddress" = ${user.walletAddress})
              AND "createdAt" >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', "createdAt")
            ORDER BY month DESC
          `,
          // Unique counterparties
          prisma.$queryRaw`
            SELECT COUNT(DISTINCT 
              CASE 
                WHEN "fromAddress" = ${user.walletAddress} THEN "toAddress"
                ELSE "fromAddress"
              END
            )::int as unique_counterparties
            FROM "Transaction"
            WHERE "fromAddress" = ${user.walletAddress} OR "toAddress" = ${user.walletAddress}
          `,
        ]);

        response.analytics = {
          summary: {
            totalIncoming: totalIncoming._sum.amount || 0,
            totalOutgoing: totalOutgoing._sum.amount || 0,
            netBalance:
              (totalIncoming._sum.amount || 0) -
              (totalOutgoing._sum.amount || 0),
            totalTransactions: totalIncoming._count + totalOutgoing._count,
            incomingTransactions: totalIncoming._count,
            outgoingTransactions: totalOutgoing._count,
            uniqueCounterparties:
              (uniqueCounterparties as any)[0]?.unique_counterparties || 0,
          },
          byType: transactionsByType.map((item) => ({
            type: item.type,
            count: item._count.type,
            totalAmount: item._sum.amount || 0,
          })),
          byMonth: transactionsByMonth,
        };
      }

      res.json(response);
    } catch (error) {
      logger.error({ err: error }, "Error fetching transaction history");
      res.status(500).json({ error: "Failed to fetch transaction history" });
    }
  },
);

/**
 * GET /api/transactions/export
 * Export transaction history as CSV/JSON for authenticated user (streamed)
 */
router.get(
  "/export",
  authenticate,
  validate({
    query: z.object({
      type: z
        .enum(["DEPOSIT", "RELEASE", "REFUND", "DISPUTE_PAYOUT"])
        .optional(),
      direction: z.enum(["incoming", "outgoing", "all"]).default("all"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      format: z.enum(["csv", "json"]).default("csv"),
    }),
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const {
        type,
        direction = "all",
        dateFrom,
        dateTo,
        format = "csv",
      } = req.query as any;

      // Build filter
      const where: any = {};

      if (direction === "incoming") {
        where.toAddress = user.walletAddress;
      } else if (direction === "outgoing") {
        where.fromAddress = user.walletAddress;
      } else {
        where.OR = [
          { fromAddress: user.walletAddress },
          { toAddress: user.walletAddress },
        ];
      }

      if (type) {
        where.type = type;
      }

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = new Date(dateFrom as string);
        }
        if (dateTo) {
          where.createdAt.lte = new Date(dateTo as string);
        }
      }

      if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="transactions-${Date.now()}.json"`,
        );
        res.write("[\n");
      } else {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="transactions-${Date.now()}.csv"`,
        );
        res.write(
          [
            "Date",
            "Type",
            "Direction",
            "Amount",
            "Token Address",
            "From Address",
            "To Address",
            "Job Title",
            "Milestone",
            "Transaction Hash",
          ].join(",") + "\n"
        );
      }

      const BATCH_SIZE = 500;
      let cursor: string | undefined = undefined;
      let hasMore = true;
      let isFirst = true;

      while (hasMore) {
        const transactions: any[] = await prisma.transaction.findMany({
          take: BATCH_SIZE,
          skip: cursor ? 1 : 0,
          cursor: cursor ? { id: cursor } : undefined,
          where,
          orderBy: { createdAt: "desc" },
          include: {
            job: {
              select: {
                id: true,
                title: true,
              },
            },
            milestone: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

        if (transactions.length === 0) {
          hasMore = false;
          break;
        }

        cursor = transactions[transactions.length - 1].id;

        if (format === "json") {
          for (let i = 0; i < transactions.length; i++) {
            if (!isFirst) {
              res.write(",\n");
            }
            res.write(JSON.stringify(transactions[i]));
            isFirst = false;
          }
        } else {
          let csvChunk = "";
          for (const tx of transactions) {
            const isIncoming = tx.toAddress === user.walletAddress;
            const row = [
              tx.createdAt.toISOString(),
              tx.type,
              isIncoming ? "incoming" : "outgoing",
              tx.amount,
              tx.tokenAddress,
              tx.fromAddress,
              tx.toAddress,
              `"${tx.job.title.replace(/"/g, '""')}"`,
              tx.milestone ? `"${tx.milestone.title.replace(/"/g, '""')}"` : "",
              tx.txHash,
            ].join(",");
            csvChunk += row + "\n";
          }
          res.write(csvChunk);
        }

        if (transactions.length < BATCH_SIZE) {
          hasMore = false;
        }
      }

      if (format === "json") {
        res.write("\n]");
      }
      
      res.end();
    } catch (error) {
      logger.error({ err: error }, "Error exporting transaction stream");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to export transaction history" });
      } else {
        res.end();
      }
    }
  },
);

/**
 * GET /api/transactions/history/by-token
 * Get transaction history grouped by token address
 */
router.get(
  "/history/by-token",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const walletAddress = user.walletAddress ?? "";

      // Get transactions grouped by token
      const transactionsByToken = await prisma.transaction.groupBy({
        by: ["tokenAddress"],
        where: {
          OR: [
            { fromAddress: walletAddress },
            { toAddress: walletAddress },
          ],
        },
        _sum: {
          amount: true,
        },
        _count: {
          tokenAddress: true,
        },
      });

      // Get detailed breakdown for each token
      const tokenDetails = await Promise.all(
        transactionsByToken.map(async (tokenGroup) => {
          const [incoming, outgoing] = await Promise.all([
            prisma.transaction.aggregate({
              where: {
                tokenAddress: tokenGroup.tokenAddress,
                toAddress: walletAddress,
              },
              _sum: { amount: true },
              _count: true,
            }),
            prisma.transaction.aggregate({
              where: {
                tokenAddress: tokenGroup.tokenAddress,
                fromAddress: walletAddress,
              },
              _sum: { amount: true },
              _count: true,
            }),
          ]);

          const countField = (tokenGroup._count as any).tokenAddress as number;
          const incomingSum = incoming._sum?.amount ?? 0;
          const outgoingSum = outgoing._sum?.amount ?? 0;

          return {
            tokenAddress: tokenGroup.tokenAddress,
            totalTransactions: countField,
            totalVolume: tokenGroup._sum?.amount ?? 0,
            incoming: {
              amount: incomingSum,
              count: incoming._count,
            },
            outgoing: {
              amount: outgoingSum,
              count: outgoing._count,
            },
            netBalance: incomingSum - outgoingSum,
          };
        }),
      );

      res.json({
        tokens: tokenDetails,
        summary: {
          uniqueTokens: transactionsByToken.length,
          totalTransactions: tokenDetails.reduce(
            (sum, t) => sum + t.totalTransactions,
            0,
          ),
          totalVolume: tokenDetails.reduce((sum, t) => sum + t.totalVolume, 0),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching transactions by token");
      res.status(500).json({ error: "Failed to fetch transactions by token" });
    }
  },
);

/**
 * GET /api/transactions/history/counterparties
 * Get list of unique counterparties (users transacted with)
 */
router.get(
  "/history/counterparties",
  authenticate,
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { page = 1, limit = 20 } = req.query as any;
      const skip = (Number(page) - 1) * Number(limit);

      // Get unique counterparties with transaction counts and volumes
      const counterparties = await prisma.$queryRaw<
        Array<{
          wallet_address: string;
          user_id: string;
          username: string;
          avatar_url: string | null;
          transaction_count: number;
          total_volume: number;
          last_transaction: Date;
        }>
      >`
        WITH counterparty_data AS (
          SELECT 
            CASE 
              WHEN "fromAddress" = ${user.walletAddress} THEN "toAddress"
              ELSE "fromAddress"
            END as wallet_address,
            COUNT(*)::int as transaction_count,
            SUM(amount)::float as total_volume,
            MAX("createdAt") as last_transaction
          FROM "Transaction"
          WHERE "fromAddress" = ${user.walletAddress} OR "toAddress" = ${user.walletAddress}
          GROUP BY wallet_address
        )
        SELECT 
          cd.wallet_address,
          u.id as user_id,
          u.username,
          u."avatarUrl" as avatar_url,
          cd.transaction_count,
          cd.total_volume,
          cd.last_transaction
        FROM counterparty_data cd
        LEFT JOIN "User" u ON u."walletAddress" = cd.wallet_address
        ORDER BY cd.transaction_count DESC, cd.last_transaction DESC
        LIMIT ${Number(limit)}
        OFFSET ${skip}
      `;

      // Get total count
      const totalCount = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(DISTINCT 
          CASE 
            WHEN "fromAddress" = ${user.walletAddress} THEN "toAddress"
            ELSE "fromAddress"
          END
        )::int as count
        FROM "Transaction"
        WHERE "fromAddress" = ${user.walletAddress} OR "toAddress" = ${user.walletAddress}
      `;

      const total = totalCount[0]?.count || 0;

      res.json({
        counterparties,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching counterparties");
      res.status(500).json({ error: "Failed to fetch counterparties" });
    }
  },
);

router.get(
  "/summary/stats",
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const wallet = user.walletAddress ?? "";

      // Get total earned (money received)
      const earned = await prisma.transaction.aggregate({
        where: {
          toAddress: wallet,
        },
        _sum: {
          amount: true,
        },
      });

      // Get total spent (money sent)
      const spent = await prisma.transaction.aggregate({
        where: {
          fromAddress: wallet,
        },
        _sum: {
          amount: true,
        },
      });

      // Get transaction counts by type
      const transactionsByType = await prisma.transaction.groupBy({
        by: ["type"],
        where: {
          OR: [
            { fromAddress: wallet },
            { toAddress: wallet },
          ],
        },
        _count: {
          type: true,
        },
      });

      // Get recent transactions
      const recentTransactions = await prisma.transaction.findMany({
        where: {
          OR: [
            { fromAddress: wallet },
            { toAddress: wallet },
          ],
        },
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          job: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      res.json({
        totalEarned: earned._sum?.amount ?? 0,
        totalSpent: spent._sum?.amount ?? 0,
        netBalance: (earned._sum?.amount ?? 0) - (spent._sum?.amount ?? 0),
        transactionsByType: transactionsByType.reduce(
          (
            acc: Record<string, number>,
            item: { type: string; _count: { type: number } },
          ) => {
            acc[item.type] = item._count.type;
            return acc;
          },
          {} as Record<string, number>,
        ),
        recentTransactions,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching transaction summary");
      res.status(500).json({ error: "Failed to fetch transaction summary" });
    }
  },
);

/**
 * GET /api/transactions/job/:jobId
 * Get all transactions for a specific job
 */
router.get(
  "/job/:jobId",
  authenticate,
  validate(jobTransactionsSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const jobId = req.params.jobId as string;
      const { page = 1, limit = 20 } = req.query as any;

      const skip = (Number(page) - 1) * Number(limit);

      // Verify job exists and user has access
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          clientId: true,
          freelancerId: true,
        },
      });

      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      if (job.clientId !== req.userId && job.freelancerId !== req.userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get transactions
      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where: { jobId },
          skip,
          take: Number(limit),
          orderBy: { createdAt: "asc" },
          include: {
            milestone: {
              select: {
                id: true,
                title: true,
                order: true,
              },
            },
          },
        }),
        prisma.transaction.count({ where: { jobId } }),
      ]);

      res.json({
        transactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching job transactions");
      res.status(500).json({ error: "Failed to fetch job transactions" });
    }
  },
);

/**
 * GET /api/transactions/:txHash
 * Lookup transaction by Stellar tx hash
 */
router.get(
  "/:txHash",
  authenticate,
  validate(txHashSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const txHash = req.params.txHash as string;

      const transaction = await prisma.transaction.findUnique({
        where: { txHash },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              clientId: true,
              freelancerId: true,
            },
          },
          milestone: {
            select: {
              id: true,
              title: true,
              order: true,
            },
          },
        },
      });

      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.userId },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Verify user has access to this transaction
      if (
        transaction.fromAddress !== user.walletAddress &&
        transaction.toAddress !== user.walletAddress &&
        transaction.job?.clientId !== req.userId &&
        transaction.job?.freelancerId !== req.userId
      ) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(transaction);
    } catch (error) {
      logger.error({ err: error }, "Error fetching transaction");
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  },
);

export default router;
