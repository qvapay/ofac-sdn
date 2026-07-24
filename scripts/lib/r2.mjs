// Cloudflare R2 (S3-compatible) helpers shared by the import scripts.
// @aws-sdk/client-s3 is lazily imported so parse-only runs work without it.

export async function r2Client() {
	const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
	const missing = required.filter((k) => !process.env[k])
	if (missing.length) throw new Error(`Missing R2 env vars: ${missing.join(', ')}`)

	let S3Client
	try {
		({ S3Client } = await import('@aws-sdk/client-s3'))
	} catch {
		throw new Error('Install @aws-sdk/client-s3 to use --upload: npm i -D @aws-sdk/client-s3')
	}

	return new S3Client({
		region: 'auto',
		endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
		},
	})
}

export async function putJson(client, key, json) {
	const { PutObjectCommand } = await import('@aws-sdk/client-s3')
	await client.send(new PutObjectCommand({
		Bucket: process.env.R2_BUCKET,
		Key: key,
		Body: json,
		ContentType: 'application/json',
		CacheControl: 'public, max-age=300',
	}))
}

export async function getJson(client, key) {
	const { GetObjectCommand } = await import('@aws-sdk/client-s3')
	try {
		const res = await client.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
		return JSON.parse(await res.Body.transformToString())
	} catch (err) {
		if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null
		throw err
	}
}
