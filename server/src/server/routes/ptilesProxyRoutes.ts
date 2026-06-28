import type { FastifyInstance } from "fastify";

/** Default upstream host for PTILES data files. */
export const DEFAULT_PTILES_BASE_URL = "https://maps.mydatatimeline.com/maps/";

/** Allowlisted file names: per-state buildings/business + the national admin grid. */
const FILE_ALLOWLIST = /^([A-Z]{2}\.(buildings_v8|business)|US\.admin)\.ptiles$/;

export interface PtilesProxyOptions {
  /** Upstream base URL (must end with "/"). */
  baseUrl?: string;
}

/**
 * The single egress to the PTILES data host. Forwards a client's Range request
 * for an allowlisted file and relays the upstream 206 + range headers + body.
 * The lookup provider consumes this route in-process via `app.inject`, so all
 * external data access flows through here.
 */
export async function registerPtilesProxyRoutes(app: FastifyInstance, options: PtilesProxyOptions = {}): Promise<void> {
  const baseUrl = options.baseUrl ?? process.env.PTILES_BASE_URL ?? DEFAULT_PTILES_BASE_URL;

  app.get<{ Querystring: { file?: string } }>("/api/ptiles/proxy", async (request, reply) => {
    const file = typeof request.query.file === "string" ? request.query.file : "";
    if (!file) {
      reply.code(400).send({ error: "Missing file" });
      return;
    }
    if (!FILE_ALLOWLIST.test(file)) {
      reply.code(403).send({ error: "File not allowed" });
      return;
    }

    const range = request.headers.range;
    const upstreamHeaders: Record<string, string> = {};
    if (typeof range === "string") upstreamHeaders.range = range;

    let upstream: Response;
    try {
      upstream = await fetch(baseUrl + file, { headers: upstreamHeaders });
    } catch (error) {
      reply.code(502).send({ error: `Upstream fetch failed: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    reply.code(upstream.status);
    for (const h of ["content-range", "content-length", "accept-ranges", "content-type"]) {
      const v = upstream.headers.get(h);
      if (v) reply.header(h, v);
    }
    reply.send(body);
  });
}
