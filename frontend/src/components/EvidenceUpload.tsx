"use client";

import { useState, useRef, useCallback } from "react";
import {
  Paperclip,
  X,
  Upload,
  Shield,
  Loader2,
  CheckCircle,
} from "lucide-react";
import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const STREAMING_HASH_THRESHOLD = 50 * 1024 * 1024;

type HashedFile = {
  file: File;
  sha256: string;
  anchorTxHash?: string;
};

type EvidenceUploadProps = {
  disputeId: string;
  onUploadComplete?: () => void;
  disabled?: boolean;
};

async function hashFileSmall(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashFileLarge(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const CHUNK_SIZE = 2 * 1024 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  let offset = 0;
  let chunkIndex = 0;

  const parts: ArrayBuffer[] = [];

  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    parts.push(buffer);
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

  const hashBuffer = await window.crypto.subtle.digest("SHA-256", combined);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (file.size > STREAMING_HASH_THRESHOLD) {
    return hashFileLarge(file, onProgress);
  }
  return hashFileSmall(file);
}

export default function EvidenceUpload({
  disputeId,
  onUploadComplete,
  disabled = false,
}: EvidenceUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [hashedFiles, setHashedFiles] = useState<HashedFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [hashProgress, setHashProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setDone(false);
    const incoming = Array.from(e.target.files || []);
    const combined = [...selectedFiles, ...incoming];

    if (combined.length > MAX_FILES) {
      setFileError(`You may attach up to ${MAX_FILES} files.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const oversized = incoming.find((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized) {
      setFileError(
        `"${oversized.name}" exceeds the ${MAX_FILE_SIZE_MB} MB limit.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFiles(combined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setHashedFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
    setDone(false);
  };

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setHashing(true);
    setHashProgress(0);
    setFileError(null);

    try {
      const hashed: HashedFile[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const sha256 = await hashFile(file, (pct) => {
          const base = (i / selectedFiles.length) * 100;
          const filePortion = (1 / selectedFiles.length) * 100;
          setHashProgress(Math.round(base + (pct / 100) * filePortion));
        });
        hashed.push({ file, sha256 });
      }
      setHashedFiles(hashed);
      setHashProgress(100);
      setHashing(false);

      setUploading(true);
      setUploadProgress(0);

      const token = localStorage.getItem("token");
      const formData = new FormData();
      const hashesArr: string[] = [];

      for (const h of hashed) {
        formData.append("files", h.file);
        hashesArr.push(h.sha256);
      }
      formData.append("hashes", JSON.stringify(hashesArr));

      await axios.post(`${API_URL}/disputes/${disputeId}/evidence`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setUploadProgress(
              Math.round((progressEvent.loaded * 100) / progressEvent.total),
            );
          }
        },
      });

      setDone(true);
      setUploading(false);
      onUploadComplete?.();
    } catch {
      setFileError("Evidence upload failed. Please try again.");
      setHashing(false);
      setUploading(false);
    }
  }, [selectedFiles, disputeId, onUploadComplete]);

  const isProcessing = hashing || uploading;

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-theme-heading">
        Evidence Upload{" "}
        <span className="font-normal text-theme-text">(with integrity proof)</span>
      </label>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isProcessing || selectedFiles.length >= MAX_FILES}
        className="flex items-center gap-2 text-sm px-3 py-2 border border-dashed border-theme-border rounded-lg text-theme-text hover:border-stellar-blue hover:text-stellar-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center"
      >
        <Paperclip size={14} />
        {selectedFiles.length >= MAX_FILES
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

      {fileError && (
        <p className="text-xs text-theme-error">{fileError}</p>
      )}

      {selectedFiles.length > 0 && (
        <ul className="space-y-1">
          {selectedFiles.map((file, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between text-xs bg-theme-card border border-theme-border rounded-md px-2 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-theme-text max-w-[200px]">
                  {file.name}
                </span>
                {hashedFiles[idx] && (
                  <span className="flex items-center gap-1 text-theme-success flex-shrink-0">
                    <Shield size={10} />
                    <span className="font-mono text-[10px]">
                      {hashedFiles[idx].sha256.slice(0, 8)}…
                    </span>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFile(idx)}
                disabled={isProcessing}
                className="ml-2 text-theme-text-muted hover:text-theme-error transition-colors flex-shrink-0"
                aria-label={`Remove ${file.name}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hashing && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-stellar-blue">
            <Shield size={12} className="animate-pulse" />
            Computing SHA-256 integrity hashes… {hashProgress}%
          </div>
          <div className="w-full bg-theme-border rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-stellar-blue h-1.5 rounded-full transition-all duration-200"
              style={{ width: `${hashProgress}%` }}
            />
          </div>
        </div>
      )}

      {uploading && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-stellar-blue">
            <Upload size={12} className="animate-bounce" />
            Uploading evidence… {uploadProgress}%
          </div>
          <div className="w-full bg-theme-border rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-stellar-blue h-1.5 rounded-full transition-all duration-200"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {done && (
        <div className="flex items-center gap-2 text-xs text-theme-success">
          <CheckCircle size={12} />
          Evidence uploaded with integrity proof
        </div>
      )}

      {selectedFiles.length > 0 && !done && (
        <button
          type="button"
          onClick={handleUpload}
          disabled={disabled || isProcessing}
          className="btn-primary w-full text-sm flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {hashing ? "Hashing…" : "Uploading…"}
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
        Files are SHA-256 hashed client-side before upload. Hashes are stored
        server-side to detect any tampering after submission.
      </p>
    </div>
  );
}
