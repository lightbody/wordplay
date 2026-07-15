import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { errorHandler } from "./errors.js";
import { registerDictionaryRoutes } from "./routes/dictionary.js";
import { registerFriendRoutes } from "./routes/friends.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerMoveRoutes } from "./routes/moves.js";
import { registerPushRoutes } from "./routes/push.js";
import { registerShapeRoutes } from "./routes/shape.js";
import { registerUserRoutes } from "./routes/users.js";

export function buildApp(ctx: AppContext, allowedOrigin: string): FastifyInstance {
  const app = Fastify({ logger: false });

  // Mirrors the Rust CorsLayer: a fixed allowed origin, any method, and any
  // requested header reflected back (tower_http's AllowHeaders::any()).
  app.register(cors, {
    origin: allowedOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.setErrorHandler(errorHandler);

  registerHealthRoutes(app);
  registerShapeRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerFriendRoutes(app, ctx);
  registerGameRoutes(app, ctx);
  registerMoveRoutes(app, ctx);
  registerInviteRoutes(app, ctx);
  registerPushRoutes(app, ctx);
  registerDictionaryRoutes(app, ctx);

  return app;
}
