import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../middleware/error";
import { validate } from "../middleware/validation";

const router = Router();
const prisma = new PrismaClient();

const SPEND_TX_TYPES = ["RELEASE", "DISPUTE_PAYOUT"] as const;
const FREELANCER_BREAKDOWN_LIMIT = 10;

/**
 * @swagger
 * /clients/earnings:
 *   get:
 *     summary: Spend summary, monthly time series, and top-freelancer breakdown for the authenticated client
 *     tags: [Clients]
 *     responses:
 *       200:
 *         description: Client spend summary
 */
router.get(
  "/earnings",
  authenticate,
  validate({
    query: z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.role !== "CLIENT") {
      return res.status(403).json({ error: "Only clients can access earnings" });
    }

    const query = req.query as unknown as { from?: Date; to?: Date };
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getFullYear(), to.getMonth() - 11, 1);

    const [totalSpentAgg, spentThisMonthAgg, monthlySpendRaw, freelancerBreakdown] =
      await Promise.all([
        prisma.transaction.aggregate({
          where: {
            type: { in: [...SPEND_TX_TYPES] },
            job: { clientId: user.id },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            type: { in: [...SPEND_TX_TYPES] },
            job: { clientId: user.id },
            createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
          _sum: { amount: true },
        }),
        prisma.$queryRaw<Array<{ month: string; spend: number }>>`
          SELECT
            TO_CHAR(DATE_TRUNC('month', t."createdAt"), 'YYYY-MM') as month,
            COALESCE(SUM(t.amount), 0)::float as spend
          FROM "Transaction" t
          JOIN "Job" j ON j."id" = t."jobId"
          WHERE j."clientId" = ${user.id}
            AND t."type" IN ('RELEASE', 'DISPUTE_PAYOUT')
            AND t."createdAt" >= ${from}
            AND t."createdAt" <= ${to}
          GROUP BY DATE_TRUNC('month', t."createdAt")
          ORDER BY month ASC
        `,
        prisma.$queryRaw<
          Array<{ freelancerId: string; displayName: string; totalPaid: number; jobCount: number }>
        >`
          SELECT
            j."freelancerId" as "freelancerId",
            u."username" as "displayName",
            COALESCE(SUM(t.amount), 0)::float as "totalPaid",
            COUNT(DISTINCT j.id)::int as "jobCount"
          FROM "Transaction" t
          JOIN "Job" j ON j."id" = t."jobId"
          JOIN "User" u ON u."id" = j."freelancerId"
          WHERE j."clientId" = ${user.id}
            AND j."freelancerId" IS NOT NULL
            AND t."type" IN ('RELEASE', 'DISPUTE_PAYOUT')
          GROUP BY j."freelancerId", u."username"
          ORDER BY "totalPaid" DESC
          LIMIT ${FREELANCER_BREAKDOWN_LIMIT}
        `,
      ]);

    // Sorted defensively in addition to the SQL ORDER BY so the descending
    // guarantee holds regardless of how the rows came back from the DB.
    const sortedBreakdown = [...freelancerBreakdown]
      .sort((a, b) => b.totalPaid - a.totalPaid)
      .slice(0, FREELANCER_BREAKDOWN_LIMIT);

    res.json({
      summary: {
        totalSpent: totalSpentAgg._sum?.amount ?? 0,
        spentThisMonth: spentThisMonthAgg._sum?.amount ?? 0,
      },
      monthlySpend: monthlySpendRaw,
      freelancerBreakdown: sortedBreakdown,
      range: { from: from.toISOString(), to: to.toISOString() },
    });
  }),
);

export default router;
