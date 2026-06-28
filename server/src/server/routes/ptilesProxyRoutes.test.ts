// @vitest-environment node
import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerPtilesProxyRoutes } from "./ptilesProxyRoutes.js";

const LIVE = process.env.PTILES_LIVE === "1";

async function buildApp() {
  const app = fastify();
  await registerPtilesProxyRoutes(app);
  return app;
}

describe("ptiles proxy route", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("rejects a missing file", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/ptiles/proxy" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-allowlisted file", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/ptiles/proxy?file=../etc/passwd" });
    expect(res.statusCode).toBe(403);
    const res2 = await app.inject({ method: "GET", url: "/api/ptiles/proxy?file=TN.roads.ptiles" });
    expect(res2.statusCode).toBe(403);
  });

  it.runIf(LIVE)("forwards a Range request and relays 206 + Content-Range", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/ptiles/proxy?file=US.admin.ptiles",
      headers: { range: "bytes=0-255" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toMatch(/^bytes 0-255\//);
    expect(res.rawPayload.length).toBe(256);
    // Magic bytes for an admin ptiles file.
    expect(res.rawPayload.subarray(0, 6).toString()).toBe("PTILES");
  });
});
