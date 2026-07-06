import { randomBytes, randomInt } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Rng } from "@wordplay/shared";
import { AppError } from "./errors.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuidParam(req: FastifyRequest, paramName = "id"): string {
  const params = req.params as Record<string, string>;
  const value = params[paramName];
  if (!value || !UUID_RE.test(value)) throw AppError.notFound();
  return value;
}

/** A shared.Rng backed by Node's CSPRNG, for bag shuffles and swap placement. */
export function systemRng(): Rng {
  return { nextInt: (max: number) => randomInt(max) };
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A uniform random alphanumeric token (rejection-sampled to avoid modulo bias). */
export function alphanumericToken(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length - out.length);
    for (const byte of bytes) {
      if (byte < 248) out += ALPHANUMERIC[byte % 62]; // 248 = 4*62, avoids bias
      if (out.length === length) break;
    }
  }
  return out;
}
