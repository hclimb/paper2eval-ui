import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'

const BUCKET = 'paper2eval'
const TASKS_PREFIX = 'tasks/'

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? 'auto',
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
})

export async function listTaskSlugs(): Promise<string[]> {
  const cmd = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: TASKS_PREFIX,
    Delimiter: '/',
  })
  const res = await s3.send(cmd)
  return (res.CommonPrefixes ?? [])
    .map((p) => p.Prefix?.replace(TASKS_PREFIX, '').replace(/\/$/, '') ?? '')
    .filter(Boolean)
}

export async function listTaskFiles(slug: string): Promise<{ key: string; size: number }[]> {
  const prefix = `${TASKS_PREFIX}${slug}/`
  const files: { key: string; size: number }[] = []
  let token: string | undefined

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    })
    const res = await s3.send(cmd)
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Size !== undefined) {
        files.push({ key: obj.Key.replace(prefix, ''), size: obj.Size })
      }
    }
    token = res.NextContinuationToken
  } while (token)

  return files
}

export async function getTaskFile(slug: string, path: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: `${TASKS_PREFIX}${slug}/${path}`,
  })
  const res = await s3.send(cmd)
  return (await res.Body?.transformToString()) ?? ''
}

export async function getS3File(key: string): Promise<string | null> {
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key })
    const res = await s3.send(cmd)
    return (await res.Body?.transformToString()) ?? null
  } catch {
    return null
  }
}

export async function listS3Prefix(prefix: string): Promise<{ key: string; size: number }[]> {
  const files: { key: string; size: number }[] = []
  let token: string | undefined

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    })
    const res = await s3.send(cmd)
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Size !== undefined) {
        files.push({ key: obj.Key.replace(prefix, ''), size: obj.Size })
      }
    }
    token = res.NextContinuationToken
  } while (token)

  return files
}
