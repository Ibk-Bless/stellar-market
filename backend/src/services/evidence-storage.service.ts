import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "fs";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";

export const EVIDENCE_DOWNLOAD_EXPIRY_SECONDS = 60;

let s3Client: S3Client | undefined;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.evidenceStorage.region,
      endpoint: config.evidenceStorage.endpoint,
      forcePathStyle: config.evidenceStorage.forcePathStyle,
    });
  }
  return s3Client;
}

export function isEvidenceStorageConfigured(): boolean {
  return Boolean(config.evidenceStorage.bucket);
}

function getBucket(): string {
  const { bucket } = config.evidenceStorage;
  if (!bucket) throw new Error("Evidence S3 storage is not configured");
  return bucket;
}

export async function uploadEvidenceObject({
  key,
  filePath,
  contentType,
}: {
  key: string;
  filePath: string;
  contentType: string;
}): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    }),
  );
}

export async function readEvidenceObject(key: string): Promise<Buffer> {
  const result = await getS3Client().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  );
  if (!result.Body) throw new Error("Evidence object not found");
  return Buffer.from(await result.Body.transformToByteArray());
}

/**
 * Creates a one-minute, attachment-specific URL. Evidence objects are private;
 * callers must pass this URL on rather than exposing the bucket URL directly.
 */
export async function createEvidenceDownloadUrl({
  key,
  filename,
  contentType,
}: {
  key: string;
  filename: string;
  contentType: string;
}): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, "_")}"`,
      ResponseContentType: contentType,
    }),
    { expiresIn: EVIDENCE_DOWNLOAD_EXPIRY_SECONDS },
  );
}
