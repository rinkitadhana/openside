/**
 * AES-256-GCM encryption for secrets at rest (self-host API keys).
 *
 * Key comes from SELFHOST_ENCRYPTION_KEY: 32 bytes, hex (64 chars) or base64.
 * Ciphertext format: v1:<iv b64>:<authTag b64>:<ciphertext b64> - versioned so
 * the scheme can rotate without breaking stored rows.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ENV = "SELFHOST_ENCRYPTION_KEY";

function getKey(): Buffer {
	const raw = process.env[KEY_ENV];
	if (!raw) {
		throw new Error(`${KEY_ENV} is not set - cannot encrypt/decrypt secrets`);
	}

	const key = /^[0-9a-fA-F]{64}$/.test(raw)
		? Buffer.from(raw, "hex")
		: Buffer.from(raw, "base64");

	if (key.length !== 32) {
		throw new Error(`${KEY_ENV} must decode to 32 bytes (got ${key.length})`);
	}

	return key;
}

export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
	const [version, ivB64, tagB64, dataB64] = stored.split(":");
	if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
		throw new Error("Unrecognized ciphertext format");
	}

	const decipher = createDecipheriv(
		"aes-256-gcm",
		getKey(),
		Buffer.from(ivB64, "base64"),
	);
	decipher.setAuthTag(Buffer.from(tagB64, "base64"));

	return Buffer.concat([
		decipher.update(Buffer.from(dataB64, "base64")),
		decipher.final(),
	]).toString("utf8");
}

/** "lk_api_1234abcd" -> "lk_a••••bcd" - safe to return to the client. */
export function maskSecret(value: string): string {
	if (value.length <= 7) return "••••••••";
	return `${value.slice(0, 4)}••••${value.slice(-3)}`;
}
