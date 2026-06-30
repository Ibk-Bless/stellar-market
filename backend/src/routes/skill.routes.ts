import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/error";
import { searchSkills } from "../services/skill.service";

const router = Router();

/**
 * @swagger
 * /skills:
 *   get:
 *     summary: Search the canonical skill taxonomy for autocomplete
 *     tags: [Skills]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search term matched against skill names (case-insensitive)
 *     responses:
 *       200:
 *         description: Up to 10 matching skills
 */
router.get(
  "/",
  validate({ query: z.object({ q: z.string().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const q = (req.query.q as string | undefined) ?? "";
    const skills = await searchSkills(q);
    res.json({ skills });
  }),
);

export default router;
