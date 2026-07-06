// New in the Node backend (not present in the Rust version): serves the
// shared wordlist with content-addressed caching, per Phase A's design.

import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function registerDictionaryRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/dictionary/version", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send({
      hash: ctx.dictionaryHash,
      size: ctx.dictionarySize,
      wordCount: ctx.dictionaryWordCount,
    });
  });

  app.get("/dictionary/:hash(^[0-9a-f]+).txt", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    if (hash !== ctx.dictionaryHash) {
      return reply.status(404).send();
    }
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.type("text/plain").send(ctx.dictionaryText);
  });
}
