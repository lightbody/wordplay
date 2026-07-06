import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async (_req, reply) => {
    reply.send({ status: "ok" });
  });
}
