import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { config } from "../config";
import { asyncHandler } from "../middleware/error";

const router = Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /unsubscribe:
 *   get:
 *     summary: Unsubscribe from marketing emails
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Signed unsubscribe JWT
 *     responses:
 *       200:
 *         description: Confirmation page
 *       400:
 *         description: Invalid or expired token
 */
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.query as { token?: string };

    if (!token) {
      return res.status(400).send(confirmationPage("Invalid link", "No unsubscribe token was provided."));
    }

    let payload: { userId: string; type: string };
    try {
      payload = jwt.verify(token, config.jwtSecret) as typeof payload;
    } catch (err) {
      const expired = err instanceof jwt.TokenExpiredError;
      return res
        .status(400)
        .send(
          confirmationPage(
            "Link expired",
            expired
              ? "This unsubscribe link has expired. Please request a new email to get a fresh link."
              : "This unsubscribe link is invalid.",
          ),
        );
    }

    if (payload.type !== "unsubscribe") {
      return res.status(400).send(confirmationPage("Invalid link", "This link cannot be used to unsubscribe."));
    }

    await prisma.notificationPreference.upsert({
      where: { userId: payload.userId },
      create: { userId: payload.userId, marketingEmails: false },
      update: { marketingEmails: false },
    });

    return res.status(200).send(confirmationPage("Unsubscribed", "You have been unsubscribed from marketing emails. You will still receive important transactional notifications."));
  }),
);

function confirmationPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — StellarMarket</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f7fb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 12px; padding: 40px 32px; max-width: 480px; width: 100%; border: 1px solid #e5e7eb; text-align: center; }
    h1 { font-size: 24px; font-weight: 700; color: #111827; margin: 0 0 12px; }
    p { color: #6b7280; line-height: 1.6; margin: 0 0 24px; }
    a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/">Return to StellarMarket</a></p>
  </div>
</body>
</html>`;
}

export default router;
