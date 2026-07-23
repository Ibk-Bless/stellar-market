"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Paperclip,
  X,
  Upload,
  Shield,
  Loader2,
  CheckCircle,
  RotateCw,
  AlertTriangle,
} from "lucide-react";
import {
  uploadFileResumable,
  hashFile,
  persistUpload,
  removePersistedUpload,
  loadPersistedUploads,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  FileUploadState,
} from "@/lib/evidenceUpload";
import { CHUNK_SIZE } from "@/lib/evidenceUpload";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

function newFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `f_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function initState(
  id: string,
  file: { name: string; size: number; type: string },
): FileUploadState {
  return {
    id,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    status: "pending",
    totalChunks: Math.max(1, Math.ceil(file.size / (2 * 1024 * 1024))),
    receivedChunks: [],
    uploadedChunks: [],
    progress: 0,
  };
}

export default function EvidenceUpload({
  disputeId,
  onUploadComplete,
  disabled = false,
}: {
  disputeId: string;
  onUploadComplete?: () => void;
  disabled?: boolean;
}) {
  const [files, setFiles] = useState<FileUploadState[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [selectedFiles, setSelectedFiles] = useState<Map<string, File>>(new Map());
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restored, setRestored] = useState(false);

  const updateFile = useCallback(
    (id: string, patch: Partial<FileUploadState>) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [],
  );

  // Recover interrupted uploads from IndexedDB after a reload.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const persisted = await loadPersistedUploads(disputeId);
        if (!active || persisted.length === 0) {
          setRestored(true);
          return;
        }
        const recovered: FileUploadState[] = persisted.map((p) => ({
          id: p.fileId,
          name: p.name,
          size: p.size,
          mimeType: p.mimeType,
          status: "pending",
          sha256: p.sha256,
          sessionId: p.sessionId,
          totalChunks: p.totalChunks,
          receivedChunks: p.uploadedChunks,
          uploadedChunks: p.uploadedChunks,
          progress: Math.round((p.uploadedChunks.length / p.totalChunks) * 100),
        }));
        // Restore the actual File blobs so the upload can continue.
        const nextSelected = new Map<string, File>();
        for (const p of persisted) {
          nextSelected.set(p.fileId, p.blob as unknown as File);
        }
        setSelectedFiles(nextSelected);
        setFiles(recovered);
      } catch {
        // Ignore recovery failures; user can re-select files.
      } finally {
        if (active) setRestored(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [disputeId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const incoming = Array.from(e.target.files || []);

    const nextSelected = new Map(selectedFiles);
    const nextStates: FileUploadState[] = [...files];
    let rejected = false;

    for (const file of incoming) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setFileError(
          `"${file.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`,
        );
        rejected = true;
        continue;
      }
      const id = newFileId();
      nextSelected.set(id, file);
      nextStates.push(initState(id, file));
    }

    if (!rejected && nextStates.length > MAX_FILES) {
      setFileError(`You may attach up to ${MAX_FILES} files.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFiles(nextSelected);
    setFiles(nextStates);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = useCallback(
    (id: string) => {
      setSelectedFiles((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setFileError(null);
      // Best-effort cleanup of persisted + server session.
      removePersistedUpload(disputeId, id).catch(() => undefined);
    },
    [disputeId],
  );

  const uploadOne = useCallback(
    async (state: FileUploadState) => {
      const file = selectedFiles.get(state.id);
      if (!file) {
        updateFile(state.id, {
          status: "failed",
          error: "File is no longer available. Re-select it.",
        });
        return;
      }

      updateFile(state.id, { status: "hashing", progress: 0, error: undefined });
      // Hash only if we don't already have a hash (e.g. resume after reload).
      let sha256 = state.sha256;
      if (!sha256) {
        try {
          sha256 = await hashFile(file);
        } catch {
          updateFile(state.id, {
            status: "failed",
            error: "Failed to compute integrity hash.",
          });
          return;
        }
      }
      updateFile(state.id, {
        sha256,
        status: "uploading",
        progress: state.uploadedChunks.length
          ? Math.round((state.uploadedChunks.length / state.totalChunks) * 100)
          : 0,
      });

      try {
        const { sessionId } = await uploadFileResumable(
          API_URL,
          localStorage.getItem("token"),
          disputeId,
          file,
          state.id,
          {
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            sha256,
          },
          { uploadedChunks: state.uploadedChunks },
          {
            onChunk: (uploaded, total) => {
              updateFile(state.id, {
                uploadedChunks: uploaded,
                receivedChunks: uploaded,
                progress: Math.round((uploaded.length / total) * 100),
              });
            },
            onProgress: (pct) => updateFile(state.id, { progress: pct }),
          },
        );
        // Persist off the critical upload path (deferred to a macrotask) so a
        // refresh can resume. The server is the source of truth for which chunks
        // were received, so the blob + metadata here are enough to continue from
        // the last chunk. IDB writes are deferred because fake-indexeddb (and the
        // app's IDB connection) share the microtask queue with the fetch loop and
        // would otherwise deadlock mid-upload.
        setTimeout(() => {
          void persistUpload({
            disputeId,
            fileId: state.id,
            name: state.name,
            size: state.size,
            mimeType: state.mimeType,
            sha256,
            sessionId,
            totalChunks: state.totalChunks,
            uploadedChunks: state.uploadedChunks,
            anchorTxHash: state.anchorTxHash,
            blob: file,
          }).catch(() => undefined);
        }, 0);
        updateFile(state.id, { status: "done", progress: 100, sessionId });
        setTimeout(() => {
          void removePersistedUpload(disputeId, state.id).catch(() => undefined);
        }, 0);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed. Retry.";
        updateFile(state.id, { status: "failed", error: message });
      }
    },
    [selectedFiles, disputeId, updateFile],
  );

  const handleUpload = useCallback(async () => {
    const snapshot = filesRef.current;
    if (snapshot.length === 0 || disabled) return;
    setFileError(null);

    for (const state of snapshot) {
      if (state.status === "done") continue;
      // eslint-disable-next-line no-await-in-loop
      await uploadOne(state);
    }

    // Use the live ref value rather than the closure-captured `files` so the
    // completion check sees the status updates written by uploadOne.
    const live = filesRef.current;
    if (live.every((f) => f.status === "done") && live.length > 0) {
      onUploadComplete?.();
    }
  }, [disabled, uploadOne, onUploadComplete]);

  const isProcessing = files.some(
    (f) => f.status === "hashing" || f.status === "uploading",
  );

  const doneCount = files.filter((f) => f.status === "done").length;
  const completedAll = files.length > 0 && doneCount === files.length;

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-theme-heading">
        Evidence Upload{" "}
        <span className="font-normal text-theme-text">(with integrity proof)</span>
      </label>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isProcessing || files.length >= MAX_FILES}
        className="flex items-center gap-2 text-sm px-3 py-2 border border-dashed border-theme-border rounded-lg text-theme-text hover:border-stellar-blue hover:text-stellar-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center"
      >
        <Paperclip size={14} />
        {files.length >= MAX_FILES
          ? `Max ${MAX_FILES} files reached`
          : `Attach files (up to ${MAX_FILES}, ${MAX_FILE_SIZE_MB} MB each)`}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isProcessing}
      />

      {fileError && <p className="text-xs text-theme-error">{fileError}</p>}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="text-xs bg-theme-card border border-theme-border rounded-md px-2 py-2 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-theme-text max-w-[200px]">
                    {f.name}
                  </span>
                  {f.sha256 && (
                    <span className="flex items-center gap-1 text-theme-success flex-shrink-0">
                      <Shield size={10} />
                      <span className="font-mono text-[10px]">
                        {f.sha256.slice(0, 8)}…
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {f.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => uploadOne(f)}
                      className="flex items-center gap-1 text-stellar-blue hover:underline"
                      aria-label={`Retry ${f.name}`}
                    >
                      <RotateCw size={12} />
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    disabled={isProcessing}
                    className="text-theme-text-muted hover:text-theme-error transition-colors"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              <FileProgress file={f} />
            </li>
          ))}
        </ul>
      )}

      {completedAll && (
        <div className="flex items-center gap-2 text-xs text-theme-success">
          <CheckCircle size={12} />
          Evidence uploaded with integrity proof
        </div>
      )}

      {files.length > 0 && !completedAll && (
        <button
          type="button"
          onClick={handleUpload}
          disabled={disabled || isProcessing}
          className="btn-primary w-full text-sm flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Shield size={14} />
              Hash & Upload Evidence
            </>
          )}
        </button>
      )}

      <p className="text-[10px] text-theme-text-muted">
        Files are SHA-256 hashed client-side before upload, then transferred in
        resumable chunks. A dropped connection resumes from the last transferred
        chunk; progress survives a page reload.
      </p>
    </div>
  );
}

function FileProgress({ file }: { file: FileUploadState }) {
  if (file.status === "hashing") {
    return (
      <div className="flex items-center gap-2 text-stellar-blue">
        <Shield size={12} className="animate-pulse" />
        <span>Computing SHA-256 integrity hash…</span>
      </div>
    );
  }
  if (file.status === "uploading") {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-stellar-blue">
          <Upload size={12} className="animate-bounce" />
          <span>
            Uploading… {file.progress}%{" "}
            {file.uploadedChunks.length > 0 &&
              `(${file.uploadedChunks.length}/${file.totalChunks} chunks)`}
          </span>
        </div>
        <div className="w-full bg-theme-border rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-stellar-blue h-1.5 rounded-full transition-all duration-200"
            style={{ width: `${file.progress}%` }}
          />
        </div>
      </div>
    );
  }
  if (file.status === "done") {
    return (
      <div className="flex items-center gap-2 text-theme-success">
        <CheckCircle size={12} />
        <span>Uploaded with integrity proof</span>
      </div>
    );
  }
  if (file.status === "failed") {
    return (
      <div className="flex items-center gap-2 text-theme-error">
        <AlertTriangle size={12} />
        <span>{file.error || "Upload failed."} You can retry this file.</span>
      </div>
    );
  }
  return (
    <div className="text-theme-text-muted">
      Ready ({Math.ceil(file.size / 1024)} KB, {file.totalChunks} chunks)
    </div>
  );
}
