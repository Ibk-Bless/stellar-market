export const JOB_CATEGORIES = [
  "Frontend",
  "Backend",
  "Smart Contract",
  "Design",
  "Mobile",
  "Documentation",
  "DevOps",
] as const;

export const JOB_SKILLS = [
  "Rust",
  "TypeScript",
  "React",
  "Figma",
  "Solidity",
  "Node.js",
  "Python",
  "Go",
  "Next.js",
  "Tailwind",
  "PostgreSQL",
  "GraphQL",
  "Docker",
  "AWS",
] as const;

export const PAYMENT_TOKENS = ["XLM", "USDC"] as const;

export type PaymentToken = (typeof PAYMENT_TOKENS)[number];

export const TOKEN_EXCHANGE_RATES: Record<PaymentToken, number> = {
  XLM: 1,
  USDC: 1,
};

export function formatTokenAmount(value: number, token: PaymentToken) {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} ${token}`;
}
