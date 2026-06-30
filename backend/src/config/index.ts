import dotenv from "dotenv";

dotenv.config();

const configuredPlatformMinimum = Number(process.env.PLATFORM_MIN_BUDGET_XLM || "1");
const platformMinBudgetXlm =
  Number.isFinite(configuredPlatformMinimum) && configuredPlatformMinimum > 0
    ? configuredPlatformMinimum
    : 1;

export const MAX_PAGE_SIZE = 100;

export const config = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || "default-secret-change-me",
  databaseUrl: process.env.DATABASE_URL,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // The minimum is kept server-side so clients cannot create zero-value jobs
  // by bypassing the posting form.
  platformMinBudgetXlm,
  evidenceStorage: {
    bucket: process.env.EVIDENCE_S3_BUCKET || "",
    region: process.env.EVIDENCE_S3_REGION || process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.EVIDENCE_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.EVIDENCE_S3_FORCE_PATH_STYLE === "true",
  },
  stellar: {
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
    rpcUrl: process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
    secondaryRpcUrl: process.env.STELLAR_SECONDARY_RPC_URL || "https://soroban-testnet.stellar.org/secondary",
    horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    escrowContractId: process.env.ESCROW_CONTRACT_ID || "",
    disputeContractId: process.env.DISPUTE_CONTRACT_ID || "",
    reputationContractId: process.env.REPUTATION_CONTRACT_ID || "",
    nativeTokenId: process.env.NATIVE_TOKEN_ID || "CDLZFC3SYJYDZT7K67VZ75YJBMKBAV27Z6Y6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z", // Native XLM on Testnet
    keeperSecretKey: process.env.KEEPER_SECRET_KEY || "",
  },
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "noreply@stellarmarket.io",
  },
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:admin@stellarmarket.io",
};
