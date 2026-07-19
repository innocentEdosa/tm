import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageClient } from "./storage-client";

const UPLOAD_URL_EXPIRY_SECONDS = 900; // 15 minutes
const DOWNLOAD_URL_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Cloudflare R2's implementation of `StorageClient` (research.md §1/§2/§6, File Upload & Storage
 * spec). Every R2-specific detail — endpoint, credentials, request shape — lives in this one file;
 * nothing outside it knows R2 (as opposed to any other S3-compatible provider) exists. Mirrors
 * `mail/zeptomail-sender.ts`'s `ZeptoMailSender` structure.
 */
export class R2StorageClient implements StorageClient {
  private client(): S3Client {
    return new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  private bucket(): string {
    return process.env.R2_BUCKET_NAME!;
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.R2_ACCOUNT_ID &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_BUCKET_NAME,
    );
  }

  async createPresignedUploadUrl(key: string, contentType: string, sizeBytes: number): Promise<string> {
    void sizeBytes; // not enforced as a signed condition (research.md §5) — verified post-hoc via headObject
    const command = new PutObjectCommand({ Bucket: this.bucket(), Key: key, ContentType: contentType });
    return getSignedUrl(this.client(), command, { expiresIn: UPLOAD_URL_EXPIRY_SECONDS });
  }

  async headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number }> {
    try {
      const result = await this.client().send(new HeadObjectCommand({ Bucket: this.bucket(), Key: key }));
      return { exists: true, sizeBytes: result.ContentLength };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotFound" || name === "NoSuchKey") {
        return { exists: false };
      }
      throw err;
    }
  }

  async createPresignedDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket(), Key: key });
    return getSignedUrl(this.client(), command, { expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }
}
