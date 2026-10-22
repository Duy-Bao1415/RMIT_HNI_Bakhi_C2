// S3-compatible object storage (Neon Storage or AWS S3). Objects are ALREADY encrypted in
// the uploader's browser; the bucket, the server and the cloud only ever hold ciphertext.
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

const globalForS3 = globalThis as unknown as { __zlS3?: S3Client }

export const BUCKET = process.env.S3_BUCKET || ''
export const s3Configured = () => !!(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)

function client(): S3Client {
  if (!globalForS3.__zlS3) {
    globalForS3.__zlS3 = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-1',
      endpoint: process.env.AWS_ENDPOINT_URL_S3 || undefined,
      forcePathStyle: !!process.env.AWS_ENDPOINT_URL_S3,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    })
  }
  return globalForS3.__zlS3
}

export async function putCiphertext(key: string, ciphertext: string) {
  await client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: ciphertext,
    ContentType: 'application/octet-stream',
  }))
}

export async function getCiphertext(key: string): Promise<string> {
  const out = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return await out.Body!.transformToString()
}

export async function listObjects(prefix = 'exam-files/') {
  const out = await client().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 100 }))
  return (out.Contents ?? []).map((o) => ({ key: o.Key!, size: o.Size ?? 0, modified: o.LastModified }))
}
