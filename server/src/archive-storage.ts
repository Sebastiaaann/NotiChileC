import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface ArchiveStorageConfig {
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
}

export interface UploadedArchiveObject {
  objectKey: string;
  metadata: Record<string, string>;
}

export function getArchiveStorageConfig(): ArchiveStorageConfig | null {
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) return null;

  return {
    bucket,
    prefix: process.env.ARCHIVE_PREFIX || "notichilec/archive",
    region: process.env.ARCHIVE_REGION || "us-east-1",
    endpoint: process.env.ARCHIVE_ENDPOINT || undefined,
  };
}

function createArchiveClient(config: ArchiveStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
  });
}

export function buildArchiveObjectKey(
  config: ArchiveStorageConfig,
  entity: string,
  partitionMonth: string,
  checksum: string
): string {
  const [year, month] = partitionMonth.split("-");
  return `${config.prefix}/${entity}/${year}/${month}/${partitionMonth}-${checksum}.parquet`;
}

export async function uploadArchiveObject(
  config: ArchiveStorageConfig,
  filePath: string,
  objectKey: string,
  metadata: Record<string, string>
): Promise<UploadedArchiveObject> {
  const client = createArchiveClient(config);
  const body = await fs.readFile(filePath);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: body,
      ContentType: "application/octet-stream",
      Metadata: metadata,
    })
  );

  return { objectKey, metadata };
}

export async function verifyArchiveObjectMetadata(
  config: ArchiveStorageConfig,
  objectKey: string,
  expectedMetadata: Record<string, string>
): Promise<boolean> {
  const client = createArchiveClient(config);
  const response = await client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    })
  );

  const actualMetadata = response.Metadata || {};
  return Object.entries(expectedMetadata).every(
    ([key, value]) => actualMetadata[key.toLowerCase()] === value
  );
}

export async function downloadArchiveObject(
  config: ArchiveStorageConfig,
  objectKey: string
): Promise<string> {
  const client = createArchiveClient(config);
  const tempPath = path.join(
    tmpdir(),
    `notichilec-restore-${objectKey.replace(/[\\/]/g, "_")}`
  );

  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    })
  );

  if (!response.Body || typeof response.Body === "string") {
    throw new Error("archive_object_empty");
  }

  const stream = response.Body as NodeJS.ReadableStream;
  const writer = createWriteStream(tempPath);
  stream.pipe(writer);
  await finished(writer);

  return tempPath;
}

export function computeChecksum(rows: Record<string, unknown>[]): string {
  const hash = createHash("sha256");
  rows
    .map((row) =>
      JSON.stringify(
        Object.keys(row)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            const value = row[key];
            acc[key] =
              value instanceof Date
                ? value.toISOString()
                : typeof value === "bigint"
                  ? value.toString()
                  : value;
            return acc;
          }, {})
      )
    )
    .forEach((serialized) => hash.update(serialized));
  return hash.digest("hex");
}
