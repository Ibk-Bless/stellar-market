import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

export async function connectWithRetry(
  prisma: PrismaClient,
  retries = 5,
  delay = 2000,
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await prisma.$connect();
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      logger.warn(
        `DB not ready, retrying in ${delay * 2 ** i}ms (attempt ${i + 1}/${retries})`,
      );
      await new Promise((r) => setTimeout(r, delay * 2 ** i));
    }
  }
}
