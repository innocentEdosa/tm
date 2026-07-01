import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import postgres from "@fastify/postgres";

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await server.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  await server.register(postgres, {
    connectionString: process.env.DATABASE_URL,
  });

  server.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  return server;
}
