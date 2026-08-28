/**
 * Signing helpers for provider requests (MovieBox signature scheme) and misc
 * hashing utilities. The signature is a base64 HMAC-MD5 over a canonical string
 * built from the method, selected headers, body digest and the canonicalized
 * URL; see the MovieBox provider report for the exact construction.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

export type QueryPairs = ReadonlyArray<readonly [string, string]>;

export function md5Hex(data: Buffer | string): string {
  return createHash("md5").update(data).digest("hex");
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function base64(input: Buffer): string {
  return input.toString("base64");
}

export function hmacMd5Base64(key: Buffer, data: string): string {
  return createHmac("md5", key).update(data, "utf8").digest("base64");
}

/** Canonical query string: sorted by key, key=value pairs joined with `&`. */
export function canonicalQuery(pairs: QueryPairs): string {
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sorted.map(([k, v]) => `${k}=${v}`).join("&");
}

export interface SignInput {
  method: string;
  accept: string;
  contentType: string;
  bodyLength: number;
  timestampMs: number;
  bodyHash: string; // md5 hex of body content (truncated to 102400 bytes)
  scheme: string;
  host: string;
  pathname: string;
  query: string; // already canonicalized sorted query
}

/** Build the MovieBox canonical string + signature headers from one attempt. */
export function signMovieBox(secretKeyBase64: string, input: SignInput): string {
  const canonical = [
    input.method.toUpperCase(),
    input.accept,
    input.contentType,
    String(input.bodyLength),
    String(input.timestampMs),
    input.bodyHash,
    `${input.scheme}://${input.host}${input.pathname}${input.query.length > 0 ? `?${input.query}` : ""}`,
  ].join("\n");
  const key = Buffer.from(secretKeyBase64, "base64");
  return hmacMd5Base64(key, canonical);
}

/** Two header values that never depend on the secret, used by MovieBox. */
export function clientTokenHeaders(timestampMs: number, randHex?: string): { "x-client-token": string } {
  const rand = randHex ?? randomBytes(8).toString("hex");
  return { "x-client-token": `${timestampMs},${rand}` };
}

export function generateUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateHash(length = 32): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}