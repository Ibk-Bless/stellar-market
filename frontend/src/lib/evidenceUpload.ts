import { openDB, IDBPDatabase } from "idb";

// Keep these in sync with the backend (evidence-upload-session.service.ts).
export const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
export const MAX_FILES = 5;
export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export type FileStatus =
  | "pending"
  | "hashing"
  | "uploading"
  | "done"
  | "failed";

export interface FileUploadState {
  id: string; // stable client id (uuid)
  name: string;
  size: number;
  mimeType: string;
  status: FileStatus;
  sha256?: string;
  sessionId?: string;
  totalChunks: number;
  receivedChunks: number[];
  uploadedChunks: number[];
  progress: number; // 0..100 (upload phase only)
  error?: string;
  anchorTxHash?: string;
}

export interface PersistedUpload {
  disputeId: string;
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  sessionId: string;
  totalChunks: number;
  uploadedChunks: number[];
  anchorTxHash?: string;
  blob: Blob; // the full File, persisted so a reload can resume
  updatedAt: number;
}

const DB_NAME = "evidence-upload-store";
const STORE = "uploads";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {
            keyPath: ["disputeId", "fileId"],
          });
          store.createIndex("byDispute", "disputeId");
        }
      },
    });
  }
  return dbPromise;
}

// ---- hashing (reuses the prior file-integrity proof) ----

async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashFile(
  file: Blob,
  onProgress?: (pct: number) => void,
): Promise<string> {
  // Stream in 2 MB slices so we never hold the whole buffer unnecessarily and so
  // the hash is computed over the exact 2 MB boundaries used for chunking.
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const hasher = await (async () => {
    // SubtleCrypto has no incremental API; accumulate slices then hash once.
    // Files are <=10MB so this is inexpensive.
    const parts: ArrayBuffer[] = [];
    let offset = 0;
    let chunkIndex = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      parts.push(await blobToArrayBuffer(slice));
      offset += CHUNK_SIZE;
      chunkIndex++;
      onProgress?.(Math.round((chunkIndex / totalChunks) * 100));
    }
    const combined = new Uint8Array(
      parts.reduce((acc, buf) => acc + buf.byteLength, 0),
    );
    let pos = 0;
    for (const buf of parts) {
      combined.set(new Uint8Array(buf), pos);
      pos += buf.byteLength;
    }
    return hashBuffer(combined.buffer);
  })();
  return hasher;
}

// ---- persistence ----

export async function persistUpload(
  upload: Omit<PersistedUpload, "updatedAt">,
): Promise<void> {
  const db = await getDB();
  await db.put(STORE, { ...upload, updatedAt: Date.now() });
}

export async function removePersistedUpload(
  disputeId: string,
  fileId: string,
): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, [disputeId, fileId]);
}

export async function loadPersistedUploads(
  disputeId: string,
): Promise<PersistedUpload[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(STORE, "byDispute", disputeId);
  return all as PersistedUpload[];
}

// ---- transport ----

export interface UploadCallbacks {
  onChunk?: (uploadedChunks: number[], totalChunks: number) => void;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  // jsdom / older environments lack Blob.arrayBuffer.
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

interface ApiClient {
  get: (url: string, headers: Record<string, string>) => Promise<any>;
  post: (
    url: string,
    body: any,
    headers: Record<string, string>,
    type?: string,
  ) => Promise<any>;
  putRaw: (
    url: string,
    body: ArrayBuffer,
    headers: Record<string, string>,
  ) => Promise<any>;
}

function buildApiClient(baseUrl: string, token: string | null): ApiClient {
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  return {
    async get(url, headers) {
      const res = await fetch(`${baseUrl}${url}`, {
        method: "GET",
        headers: { ...authHeader, ...headers },
      });
      return res;
    },
    async post(url, body, headers) {
      const res = await fetch(`${baseUrl}${url}`, {
        method: "POST",
        headers: { ...authHeader, ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res;
    },
    async putRaw(url, body, headers) {
      const res = await fetch(`${baseUrl}${url}`, {
        method: "PUT",
        headers: { ...authHeader, ...headers },
        body: body,
      });
      return res;
    },
  };
}

export interface CompletedAttachment {
  id: string;
  sha256: string;
  size: number;
  originalName: string;
}

/**
 * Upload one file as a resumable, chunked session.
 *
 * - Initiates (or resumes) a server session keyed by (dispute, uploader, hash).
 * - Skips chunks the server already reports as received (handles mid-upload
 *   interruption and page-reload recovery).
 * - Persists each chunk success to IndexedDB so progress survives a reload.
 * - Completes the session server-side, which re-verifies the SHA-256.
 */
export async function uploadFileResumable(
  baseUrl: string,
  token: string | null,
  disputeId: string,
  file: Blob,
  fileId: string,
  meta: { name: string; mimeType: string; sha256: string; anchorTxHash?: string },
  opts: { receivedChunks?: number[]; uploadedChunks?: number[] } = {},
  callbacks: UploadCallbacks = {},
): Promise<{ sessionId: string; attachment: CompletedAttachment }> {
  const api = buildApiClient(baseUrl, token);
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

  // 1. Initiate / resume: server returns which chunks it already has.
  const initRes = await api.post(
    `/disputes/${disputeId}/evidence/sessions`,
    {
      originalName: meta.name,
      sha256: meta.sha256,
      size: file.size,
      mimeType: meta.mimeType,
      chunkSize: CHUNK_SIZE,
      totalChunks,
      anchorTxHash: meta.anchorTxHash ?? null,
    },
    {},
  );
  if (!initRes.ok) {
    throw new Error((await safeError(initRes)) || "Failed to start upload session");
  }
  const initJson = await initRes.json();
  const sessionId: string = initJson.sessionId;
  const receivedChunks: number[] = initJson.receivedChunks ?? [];
  const uploadedChunks = new Set<number>([
    ...receivedChunks,
    ...(opts.uploadedChunks ?? []),
  ]);

  callbacks.onChunk?.([...uploadedChunks], totalChunks);

  // 2. Upload only the chunks the server does not yet have.
  const headers = { "Content-Type": "application/octet-stream" };
  for (let index = 0; index < totalChunks; index++) {
    if (callbacks.signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    if (uploadedChunks.has(index)) continue;

    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    const buf = await blobToArrayBuffer(blob);

    const putRes = await api.putRaw(
      `/disputes/${disputeId}/evidence/sessions/${sessionId}/chunks/${index}`,
      buf,
      headers,
    );
    if (!putRes.ok) {
      throw new Error((await safeError(putRes)) || "Failed to upload chunk");
    }
    const putJson = await putRes.json();
    const serverReceived: number[] = putJson.receivedChunks ?? [...uploadedChunks, index];
    uploadedChunks.clear();
    for (const c of serverReceived) uploadedChunks.add(c);
    uploadedChunks.add(index);

    callbacks.onChunk?.([...uploadedChunks], totalChunks);
    callbacks.onProgress?.(Math.round((uploadedChunks.size / totalChunks) * 100));
  }

  // 3. Complete: server re-assembles, verifies SHA-256, stores to S3.
  const completeRes = await api.post(
    `/disputes/${disputeId}/evidence/sessions/${sessionId}/complete`,
    {},
    {},
  );
  if (!completeRes.ok) {
    throw new Error(
      (await safeError(completeRes)) ||
        "Failed to finalize upload (integrity check failed)",
    );
  }
  const completeJson = await completeRes.json();

  return {
    sessionId,
    attachment: {
      id: completeJson.attachment.id,
      sha256: completeJson.attachment.sha256,
      size: completeJson.attachment.size,
      originalName: completeJson.attachment.originalName,
    },
  };
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const json = await res.json();
    return json?.error ?? null;
  } catch {
    return null;
  }
}

export function chunkInfo(fileSize: number): { totalChunks: number } {
  return { totalChunks: Math.max(1, Math.ceil(fileSize / CHUNK_SIZE)) };
}
