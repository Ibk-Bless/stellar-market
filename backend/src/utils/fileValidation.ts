import { ALLOWED_MIME_TYPES } from "../config/upload";
import fs from "fs";
import { Buffer } from "buffer";

/**
 * Validate file MIME type by reading file content (MIME sniffing)
 * This prevents users from bypassing validation by changing file extensions
 */
export async function validateFileMimeType(
  filePath: string,
  declaredMimeType?: string
): Promise<{ valid: boolean; detectedType?: string; error?: string }> {
  try {
    const buffer = Buffer.alloc(12);
    const fh = await fs.promises.open(filePath, "r");
    const { bytesRead } = await fh.read(buffer, 0, 12, 0);
    await fh.close();

    if (bytesRead < 4) {
      return { valid: false, error: "File is too small or empty" };
    }

    let detectedType = "application/octet-stream";

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      detectedType = "image/jpeg";
    }
    // PNG: 89 50 4E 47
    else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      detectedType = "image/png";
    }
    // PDF: %PDF (25 50 44 46)
    else if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      detectedType = "application/pdf";
    }
    // MP4: offset 4 ftyp (66 74 79 70)
    else if (bytesRead >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
      detectedType = "video/mp4";
    } else {
      return { valid: false, error: "Unsupported file type signature" };
    }

    if (declaredMimeType && declaredMimeType !== detectedType) {
      return { valid: false, error: "Declared MIME type does not match actual file content" };
    }

    return {
      valid: true,
      detectedType,
    };
  } catch (error) {
    return {
      valid: false,
      error: "Error validating file type",
    };
  }
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "video/mp4": ".mp4",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
  };

  return mimeToExt[mimeType] || "";
}
