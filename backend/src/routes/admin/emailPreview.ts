import { Router, Request, Response } from "express";
import { renderEmailTemplate } from "../../utils/emailTemplateRenderer";

const router = Router();

/**
 * GET /admin/email-preview/:template
 * Preview email templates with sample data
 * Only available in non-production environments
 */
router.get("/email-preview/:template", (req: Request, res: Response) => {
  // Only available in non-production environments
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }

  const template = Array.isArray(req.params.template)
    ? req.params.template[0]
    : req.params.template;
  let vars: Record<string, unknown> = {};

  // Parse vars from query string
  try {
    const rawVars = req.query.vars;
    if (rawVars && typeof rawVars === "string") {
      vars = JSON.parse(rawVars);
    }
  } catch {
    return res.status(400).json({ error: "Invalid vars JSON" });
  }

  // Render the template
  try {
    const html = renderEmailTemplate(template, vars);
    res.setHeader("Content-Type", "text/html");
    return res.send(html);
  } catch (err) {
    return res.status(404).json({
      error: err instanceof Error ? err.message : "Template not found",
    });
  }
});

export default router;
