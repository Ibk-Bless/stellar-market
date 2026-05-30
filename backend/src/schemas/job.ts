import { z } from "zod";
import { paginationSchema, jobStatusSchema } from "./common";

export const createJobSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters long")
    .max(200, "Title must be less than 200 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters long")
    .max(5000, "Description must be less than 5000 characters"),
  budget: z.number().positive("Budget must be a positive number"),
  skills: z
    .array(z.string())
    .min(1, "At least one skill is required")
    .max(10, "Cannot have more than 10 skills"),
  deadline: z.string().datetime("Invalid deadline format"),
  category: z.string().min(2, "Category is required"),
});

export const updateJobSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters long")
    .max(200, "Title must be less than 200 characters")
    .optional(),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters long")
    .max(5000, "Description must be less than 5000 characters")
    .optional(),
  budget: z.number().positive("Budget must be a positive number").optional(),
  skills: z
    .array(z.string())
    .min(1, "At least one skill is required")
    .max(10, "Cannot have more than 10 skills")
    .optional(),
  deadline: z.string().datetime("Invalid deadline format").optional(),
  category: z.string().min(2, "Category is required").optional(),
  status: jobStatusSchema.optional(),
});

export const getJobsQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  category: z.string().optional(),
  skill: z.string().optional(),
  skills: z.string().optional(),
  status: z.string().optional(),
  minBudget: z.coerce.number().positive().optional(),
  maxBudget: z.coerce.number().positive().optional(),
  clientId: z.string().min(1).optional(),
  token: z.string().optional(),
  sort: z
    .enum([
      "newest",
      "oldest",
      "budget_high",
      "budget_low",
      "budget_desc",
      "budget_asc",
      "created_at",
    ])
    .optional(),
     postedAfter: z.string().optional(),
     cursor: z.string().optional(),
});

export const getJobByIdParamSchema = z.object({
  id: z.string().min(1, "ID is required"),
})
  .or(
    z.object({
      jobId: z.string().min(1, "Job ID is required"),
    }),
  )
  .transform((params) => {
    const id = "id" in params ? params.id : params.jobId;
    return { id, jobId: id };
  });

export const updateJobStatusSchema = z.object({
  status: jobStatusSchema,
});

export const getSavedJobsQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  category: z.string().optional(),
  skill: z.string().optional(),
  minBudget: z.coerce.number().positive().optional(),
  maxBudget: z.coerce.number().positive().optional(),
});
