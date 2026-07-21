import crypto from "crypto";
import fs from "fs";
import path from "path";
import { UPLOAD_DIR, MAX_FILE_SIZE } from "../config/upload";

/**
 * Chunked / resumable evidence upload sessions.
 *
 * A session is a single file being uploaded to a single dispute by a single
 * uploader. Chunk boundaries mirror the 2 MB boundaries the client already uses
 * for SHA-256 hashing, so the network transfer and the integrity proof share the
 * same unit of progress. Session state lives entirely on disk under
 * SESSION_ROOT/<sessionId>/, so "which chunks are already here" is derived from
 * the filesystem (a completed rename) rather than trusted client state. That
 * makes resume deterministic: same inputs -> same received-chunk set.
 */

export const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB, matches client hashing chunks
export const MAX_CHUNK_SIZE = 4 * 1024 * 1024; // upper bound accepted per chunk
// A 10 MB max file at the smallest sane chunk (256 KB) is 40 chunks; cap well above.
export const MAX_TOTAL_CHUNKS = 64;
export const MIN_CHUNK_SIZE = 256 * 1024; // 256 KB floor to bound chunk count

export const SESSION_ROOT =
  process.env.EVIDENCE_SESSION_DIR ||
  path.join(UPLOAD_DIR, "evidence-sessions");

if (!fs.existsSync(SESSION_ROOT)) {
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

export interface SessionManifest {
  sessionId: string;
  disputeId: string;
  uploaderId: string;
  originalName: string;
  sha256: string; // client-declared integrity hash
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  anchorTxHash?: string | null;
  createdAt: string;
}

export interface InitiateInput {
  disputeId: string;
  uploaderId: string;
  originalName: string;
  sha256: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  anchorTxHash?: string | null;
  createdAt: string; // caller supplies timestamp (routes are the impure boundary)
}

const HEX64 = /^[a-f0-9]{64}$/;

function assertSafeSessionId(sessionId: string): void {
  if (!HEX64.test(sessionId)) {
    throw new Error("Invalid session id");
  }
}

function sessionDir(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return path.join(SESSION_ROOT, sessionId);
}

function manifestPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), "manifest.json");
}

function chunkPath(sessionId: string, index: number): string {
  return path.join(sessionDir(sessionId), `chunk_${index}`);
}

/**
 * Deterministic session id. A page reload can recompute the identical id from
 * (dispute, uploader, file hash) and resume the same server-side session even
 * if the client lost its local reference.
 */
export function deriveSessionId(
  disputeId: string,
  uploaderId: string,
  sha256: string,
): string {
  return crypto
    .createHash("sha256")
    .update(`${disputeId}:${uploaderId}:${sha256}`)
    .digest("hex");
}

/**
 * Validate the metadata a client proposes for a new session. Returns an error
 * string on rejection, or null when acceptable.
 */
export function validateInitiateInput(
  input: Pick<
    InitiateInput,
    "size" | "chunkSize" | "totalChunks" | "sha256"
  >,
): string | null {
  const { size, chunkSize, totalChunks, sha256 } = input;

  if (!HEX64.test(sha256)) return "sha256 must be a 64-character hex digest";
  if (!Number.isInteger(size) || size < 0) return "size must be a non-negative integer";
  if (size > MAX_FILE_SIZE) return "File exceeds the maximum allowed size";
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE)
    return `chunkSize must be an integer >= ${MIN_CHUNK_SIZE}`;
  if (chunkSize > MAX_CHUNK_SIZE) return "chunkSize exceeds the maximum allowed";
  if (!Number.isInteger(totalChunks) || totalChunks < 1)
    return "totalChunks must be a positive integer";
  if (totalChunks > MAX_TOTAL_CHUNKS) return "Too many chunks";

  const expectedChunks = Math.max(1, Math.ceil(size / chunkSize));
  if (totalChunks !== expectedChunks)
    return "totalChunks is inconsistent with size and chunkSize";

  return null;
}

export function getSession(sessionId: string): SessionManifest | null {
  const mp = manifestPath(sessionId);
  if (!fs.existsSync(mp)) return null;
  try {
    return JSON.parse(fs.readFileSync(mp, "utf-8")) as SessionManifest;
  } catch {
    return null;
  }
}

/**
 * Which chunk indexes are already fully persisted. A chunk only counts once its
 * atomic rename from chunk_N.part -> chunk_N has completed, so a crash mid-write
 * never makes a partial chunk look complete.
 */
export function getReceivedChunks(sessionId: string): number[] {
  const dir = sessionDir(sessionId);
  if (!fs.existsSync(dir)) return [];
  const received: number[] = [];
  for (const name of fs.readdirSync(dir)) {
    const m = /^chunk_(\d+)$/.exec(name);
    if (m) received.push(Number(m[1]));
  }
  return received.sort((a, b) => a - b);
}

/**
 * Create the session if new, or return the existing one (idempotent). When a
 * session already exists for the derived id we treat the on-disk manifest as
 * authoritative unless the declared file identity (hash/size/chunking) differs,
 * in which case the stale session is discarded and recreated.
 */
export function initiateSession(input: InitiateInput): {
  sessionId: string;
  manifest: SessionManifest;
  receivedChunks: number[];
} {
  const sessionId = deriveSessionId(
    input.disputeId,
    input.uploaderId,
    input.sha256,
  );
  const dir = sessionDir(sessionId);
  const existing = getSession(sessionId);

  const identityMatches =
    existing &&
    existing.sha256 === input.sha256 &&
    existing.size === input.size &&
    existing.chunkSize === input.chunkSize &&
    existing.totalChunks === input.totalChunks;

  if (existing && identityMatches) {
    return {
      sessionId,
      manifest: existing,
      receivedChunks: getReceivedChunks(sessionId),
    };
  }

  if (existing && !identityMatches) {
    // Same id, different file identity: wipe and start clean.
    fs.rmSync(dir, { recursive: true, force: true });
  }

  fs.mkdirSync(dir, { recursive: true });
  const manifest: SessionManifest = {
    sessionId,
    disputeId: input.disputeId,
    uploaderId: input.uploaderId,
    originalName: input.originalName,
    sha256: input.sha256,
    size: input.size,
    mimeType: input.mimeType,
    chunkSize: input.chunkSize,
    totalChunks: input.totalChunks,
    anchorTxHash: input.anchorTxHash ?? null,
    createdAt: input.createdAt,
  };
  fs.writeFileSync(manifestPath(sessionId), JSON.stringify(manifest));

  return { sessionId, manifest, receivedChunks: [] };
}

/**
 * Persist one chunk. Idempotent: re-sending an already-stored chunk is a no-op
 * success, which is exactly what a retry after an ambiguous failure needs.
 */
export function saveChunk(
  sessionId: string,
  index: number,
  data: Buffer,
): { receivedChunks: number[] } {
  const manifest = getSession(sessionId);
  if (!manifest) throw new Error("Session not found");

  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
    throw new Error("Chunk index out of range");
  }

  const isLast = index === manifest.totalChunks - 1;
  const maxLen = manifest.chunkSize;
  if (data.length > maxLen) throw new Error("Chunk larger than declared chunkSize");
  if (!isLast && data.length !== manifest.chunkSize) {
    throw new Error("Non-final chunk must be exactly chunkSize bytes");
  }

  const finalPath = chunkPath(sessionId, index);
  const tmpPath = `${finalPath}.part`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, finalPath); // atomic publish

  return { receivedChunks: getReceivedChunks(sessionId) };
}

export interface AssembledFile {
  filePath: string;
  computedSha256: string;
  verified: boolean;
  manifest: SessionManifest;
}

/**
 * Concatenate chunks in order into a single assembled file and recompute the
 * SHA-256 over the assembled bytes. `verified` is true only when the recomputed
 * hash matches the client-declared hash, so a resumed/retried upload that
 * silently corrupted a chunk cannot pass as "matching" the original.
 */
export function assembleAndVerify(sessionId: string): AssembledFile {
  const manifest = getSession(sessionId);
  if (!manifest) throw new Error("Session not found");

  const received = new Set(getReceivedChunks(sessionId));
  for (let i = 0; i < manifest.totalChunks; i++) {
    if (!received.has(i)) throw new Error(`Missing chunk ${i}`);
  }

  const assembledPath = path.join(sessionDir(sessionId), "assembled.bin");
  const out = fs.openSync(assembledPath, "w");
  const hash = crypto.createHash("sha256");
  let assembledSize = 0;
  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      const buf = fs.readFileSync(chunkPath(sessionId, i));
      fs.writeSync(out, buf);
      hash.update(buf);
      assembledSize += buf.length;
    }
  } finally {
    fs.closeSync(out);
  }

  const computedSha256 = hash.digest("hex");
  const verified =
    computedSha256 === manifest.sha256 && assembledSize === manifest.size;

  return { filePath: assembledPath, computedSha256, verified, manifest };
}

export function cleanupSession(sessionId: string): void {
  const dir = sessionDir(sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}