import { z } from "zod";

export const createInvitationSchema = z.object({
  freelancerId: z.string().min(1, "Freelancer ID is required"),
  message: z
    .string()
    .max(1000, "Message must be less than 1000 characters")
    .optional(),
});

export const invitationJobParamSchema = z.object({
  jobId: z.string().min(1, "Job ID is required"),
});
