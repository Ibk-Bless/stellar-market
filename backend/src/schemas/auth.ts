import { z } from "zod";
import { emailSchema, passwordSchema, stellarAddressSchema } from "./common";

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  stellarAddress: stellarAddressSchema.optional().nullable(),
  name: z
    .string()
    .min(2, "Name must be at least 2 characters long")
    .max(100, "Name must be less than 100 characters"),
  role: z.enum(["CLIENT", "FREELANCER"]).default("FREELANCER"),
  referralCode: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const walletAuthSchema = z.object({
  publicKey: stellarAddressSchema,
  message: z.string().min(1, "Signed message is required"),
  signature: z.string().min(1, "Signature is required"),
});

export const walletLinkSchema = walletAuthSchema;

export const updateStellarAddressSchema = z.object({
  stellarAddress: stellarAddressSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: passwordSchema,
});

export const verifyEmailParamSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});

export const twoFactorVerifySchema = z.object({
  code: z.string().length(6, "Code must be exactly 6 digits").regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export const twoFactorValidateSchema = z.object({
  code: z.string().min(1, "Code is required"),
  tempToken: z.string().min(1, "Temporary token is required"),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required").optional(),
});
