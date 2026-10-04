import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Storage, assertSafeKey } from './storage';

export type S3Config = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

/** S3-compatible object storage (AWS S3, MinIO, Cloudflare R2). */
export class S3Storage extends Storage {
  private readonly client: S3Client;

  constructor(
    private readonly config: S3Config,
    publicBaseUrl: string,
  ) {
    super(publicBaseUrl);
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Keys are random and never rewritten, so objects can be cached forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
