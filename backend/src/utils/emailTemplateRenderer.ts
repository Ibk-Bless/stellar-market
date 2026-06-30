import * as fs from "fs";
import * as path from "path";
import * as Handlebars from "handlebars";

const TEMPLATE_DIR = path.join(__dirname, "../templates/email/handlebars");

// Cache compiled templates at module load time to avoid repeated disk reads
const templateCache = new Map<string, Handlebars.TemplateDelegate>();

/**
 * Renders an email template using Handlebars.
 * Templates are cached after first load for performance.
 *
 * @param templateName - Name of the template file (without .hbs extension)
 * @param data - Variables to pass to the template
 * @returns Rendered HTML string with all variables escaped by default
 * @throws Error if template file is not found
 */
export function renderEmailTemplate(
  templateName: string,
  data: Record<string, unknown>,
): string {
  if (!templateCache.has(templateName)) {
    const filePath = path.join(TEMPLATE_DIR, `${templateName}.hbs`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Email template not found: ${templateName}`);
    }
    const source = fs.readFileSync(filePath, "utf-8");
    templateCache.set(templateName, Handlebars.compile(source));
  }
  const compiled = templateCache.get(templateName)!;
  return compiled(data);
}
