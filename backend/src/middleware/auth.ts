import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { PrismaClient, UserRole } from "@prisma/client";
import { logger } from "../lib/logger";

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: UserRole;
  /** walletAddress claim from the JWT, present only when the token was issued
   *  after a successful POST /auth/wallet/verify challenge-response round-trip. */
  userWalletAddress?: string;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Access denied. No token provided." });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      walletAddress?: string;
      purpose?: string;
    };

    if (decoded.purpose === "2fa_pending") {
      res.status(401).json({ error: "2FA verification required." });
      return;
    }

    req.userId = decoded.userId;
    if (decoded.walletAddress) {
      req.userWalletAddress = decoded.walletAddress;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, emailVerified: true },
    });

    if (!user) {
      res.status(401).json({ error: "User not found." });
      return;
    }

    // Check if email verification is required for this route
    const exemptRoutes = [
      "/auth/send-verification",
      "/auth/verify-email",
      "/auth/login",
      "/auth/2fa/validate",
      "/auth/forgot-password",
      "/auth/reset-password",
      "/auth/refresh",
      "/auth/logout",
    ];

    const isExempt = exemptRoutes.some((route) => req.path.includes(route));

    if (!isExempt && !user.emailVerified) {
      res.status(403).json({
        error: "Email not verified.",
        message:
          "Please check your inbox and click the verification link before continuing.",
        code: "EMAIL_NOT_VERIFIED",
      });
      return;
    }

    req.userRole = user.role;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
};

export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // First authenticate the user
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Access denied. No token provided." });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
    req.userId = decoded.userId;

    // Query database for user role
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true },
    });

    if (!user) {
      res.status(401).json({ error: "User not found." });
      return;
    }

    if (user.role !== UserRole.ADMIN) {
      res
        .status(403)
        .json({ error: "Access denied. Admin privileges required." });
      return;
    }

    req.userRole = user.role;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
};

/**
 * Optional authentication middleware.
 *
 * Identical to `authenticate` except it does NOT reject the request when no
 * token is supplied.  Routes that are publicly accessible but need to behave
 * differently for signed-in users (e.g. field-level projections) should use
 * this middleware instead of `authenticate`.
 *
 * When a valid token is present, `req.userId` and `req.userRole` are populated
 * exactly as they would be by `authenticate`.  When no token is present (or the
 * token is invalid) the request continues with `req.userId === undefined`.
 */
export const optionalAuthenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  // No token supplied — continue as anonymous
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      walletAddress?: string;
      purpose?: string;
    };

    // A 2FA-pending token is not a full session; treat as anonymous
    if (decoded.purpose === "2fa_pending") {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, emailVerified: true },
    });

    if (!user) {
      return next();
    }

    req.userId = decoded.userId;
    req.userRole = user.role;
    if (decoded.walletAddress) {
      req.userWalletAddress = decoded.walletAddress;
    }
  } catch {
    // Invalid / expired token — continue as anonymous
  }

  return next();
};

export const checkSuspension = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.userId) {
    next();
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isSuspended: true, suspendReason: true },
    });

    if (user && user.isSuspended) {
      res.status(403).json({
        error: "Account suspended.",
        reason: user.suspendReason || "Your account has been suspended.",
      });
      return;
    }

    next();
  } catch (error) {
    logger.error({ err: error }, "Error checking suspension status");
    next();
  }
};
