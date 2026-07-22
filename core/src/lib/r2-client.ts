/**
 * Cloudflare R2 client (S3-compatible).
 *
 * R2 exposes an S3 API, so we use @aws-sdk/client-s3 pointed at the R2
 * endpoint. Region must be "auto" for R2. Credentials are an R2 API token's
 * access key id / secret access key.
 */

import { S3Client } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

export const R2_BUCKET = process.env.R2_BUCKET ?? "";

let cachedClient: S3Client | null = null;

export function isR2Configured(): boolean {
	return Boolean(accountId && accessKeyId && secretAccessKey && R2_BUCKET);
}

/**
 * Lazily build (and cache) the S3 client. Throws if R2 isn't configured so
 * callers fail loudly instead of silently uploading nowhere.
 */
export function getR2Client(): S3Client {
	if (!isR2Configured()) {
		throw new Error(
			"R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
		);
	}

	if (!cachedClient) {
		cachedClient = new S3Client({
			region: "auto",
			endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: accessKeyId as string,
				secretAccessKey: secretAccessKey as string,
			},
		});
	}

	return cachedClient;
}
