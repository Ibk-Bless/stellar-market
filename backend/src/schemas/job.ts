import { z } from "zod";
import { paginationSchema, jobStatusSchema } from "./common";
import { config } from "../config";

const platformMinimumBudget = Number.isFinite(config.platformMinBudgetXlm)
  ? config.platformMinBudgetXlm
  : 1;
const minimumBudgetMessage = `Budget must be at least ${platformMinimumBudget} XLM`;

export const createJobSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters long")
    .max(200, "Title must be less than 200 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters long")
    .max(5000, "Description must be less than 5000 characters"),
  budget: z.number().min(platformMinimumBudget, minimumBudgetMessage),
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

// ─── Response projection schemas ─────────────────────────────────────────────
//
// Three tiers control what client data is returned from job endpoints:
//
//  publicJobProjection       – unauthenticated callers
//                              client.email / client.walletAddress are never included
//  authenticatedJobProjection – signed-in non-client callers
//                              client.walletAddress is exposed; email is never exposed
//  ownerJobProjection         – the client who owns the job (full record minus email)
//
// All three omit client.email because it must never be sent to non-clients.

/** Minimal client stub returned for anonymous requests. */
const publicClientStub = z.object({
  id: z.string(),
  username: z.string(),
  avatarUrl: z.string().nullable().optional(),
});

/** Client stub for authenticated non-owner callers — includes walletAddress. */
const authenticatedClientStub = publicClientStub.extend({
  walletAddress: z.string().nullable().optional(),
});

/** Shared job base fields present in every projection. */
const baseJobFields = {
  id: z.string(),
  title: z.string(),
  description: z.string(),
  budget: z.number(),
  category: z.string(),
  createdAt: z.date().or(z.string()),
};

/**
 * Unauthenticated projection.
 * Only exposes: id, title, description, budget, category, createdAt,
 * and client.displayName (username + avatarUrl).
 * client.email and client.walletAddress are intentionally absent.
 */
export const publicJobProjectionSchema = z.object({
  ...baseJobFields,
  client: publicClientStub,
});

/**
 * Authenticated non-client projection.
 * Extends public projection with walletAddress and operational fields.
 * client.email is intentionally absent.
 */
export const authenticatedJobProjectionSchema = z.object({
  ...baseJobFields,
  status: z.string(),
  skills: z.array(z.string()),
  deadline: z.date().or(z.string()),
  escrowStatus: z.string(),
  clientId: z.string(),
  freelancerId: z.string().nullable().optional(),
  updatedAt: z.date().or(z.string()),
  client: authenticatedClientStub,
  freelancer: z
    .object({
      id: z.string(),
      username: z.string(),
      avatarUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  _count: z.object({ applications: z.number() }).optional(),
});

/**
 * Owner (client) projection — full record, email still excluded.
 * Clients can see walletAddress and all operational fields on their own jobs.
 */
export const ownerJobProjectionSchema = authenticatedJobProjectionSchema;

// ─── List response wrappers ───────────────────────────────────────────────────

const paginationMeta = z.object({
  total: z.number(),
  page: z.number().nullable().optional(),
  limit: z.number(),
  totalPages: z.number().optional(),
  hasNext: z.boolean(),
  nextCursor: z.string().nullable().optional(),
});

export const publicJobListResponseSchema = z.object({
  data: z.array(publicJobProjectionSchema),
  pagination: paginationMeta,
});

export const authenticatedJobListResponseSchema = z.object({
  data: z.array(authenticatedJobProjectionSchema),
  pagination: paginationMeta,
});

// ─── Single-job response schemas (GET /:id) ───────────────────────────────────

/** Additional fields only present on single-job responses. */
const singleJobExtra = {
  milestones: z.array(z.any()).optional(),
  applications: z.array(z.any()).optional(),
  isSaved: z.boolean().optional(),
  escrow_status: z.string().optional(),
  revisionProposal: z.any().nullable().optional(),
};

export const publicSingleJobResponseSchema = publicJobProjectionSchema.extend(singleJobExtra);

export const authenticatedSingleJobResponseSchema = authenticatedJobProjectionSchema.extend(singleJobExtra);

export const ownerSingleJobResponseSchema = authenticatedSingleJobResponseSchema;
