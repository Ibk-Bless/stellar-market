import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { createError } from "./error";

export const validate = (schema: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }

      // Validate query parameters
      if (schema.query) {
        req.query = schema.query.parse(req.query) as any;
      }

      // Validate route parameters
      if (schema.params) {
        req.params = schema.params.parse(req.params) as any;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const budgetMinimumError = error.issues.find(
          (issue) =>
            issue.path.length === 1 &&
            issue.path[0] === "budget" &&
            issue.message.startsWith("Budget must be at least "),
        );
        if (budgetMinimumError) {
          return res.status(422).json({
            code: "BudgetBelowMinimum",
            message: budgetMinimumError.message,
          });
        }
        return next(createError("Validation failed", 400, error.issues));
      }
      next(error);
    }
  };
};
