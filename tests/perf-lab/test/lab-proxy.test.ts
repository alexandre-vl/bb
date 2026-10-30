import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseRouteDelay,
  resolveRouteDelay,
  resolveStaticFile,
} from "../src/lab-proxy.js";

describe("route delays", () => {
  it("matches globs against the path and query, with an optional method", () => {
    const delays = [
      parseRouteDelay("/api/v1/environments/*/status*=1500"),
      parseRouteDelay("POST /api/v1/threads/*=300"),
    ];

    expect(
      resolveRouteDelay(
        delays,
        "GET",
        "/api/v1/environments/env_1/status?mergeBaseBranch=main",
      ),
    ).toBe(1500);
    expect(resolveRouteDelay(delays, "POST", "/api/v1/threads/thr_1")).toBe(
      300,
    );
    expect(resolveRouteDelay(delays, "GET", "/api/v1/threads/thr_1")).toBe(0);
    expect(resolveRouteDelay(delays, "GET", "/api/v1/environments/env_1")).toBe(
      0,
    );
  });

  it("treats regex characters in the glob literally", () => {
    const delays = [
      parseRouteDelay("/api/v1/threads/thr_1/timeline?deferContent=true=200"),
    ];

    expect(
      resolveRouteDelay(
        delays,
        "GET",
        "/api/v1/threads/thr_1/timeline?deferContent=true",
      ),
    ).toBe(200);
    expect(
      resolveRouteDelay(
        delays,
        "GET",
        "/api/v1/threads/thr_1/timelineXdeferContent=true",
      ),
    ).toBe(0);
  });

  it("rejects a delay without a duration", () => {
    expect(() => parseRouteDelay("/api/v1/threads/*")).toThrow(/--delay/u);
    expect(() => parseRouteDelay("/api/v1/threads/*=-5")).toThrow(/--delay/u);
  });
});

describe("resolveStaticFile", () => {
  const dist = mkdtempSync(join(tmpdir(), "perf-lab-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<html></html>");
  writeFileSync(join(dist, "assets", "app.js"), "app");
  writeFileSync(join(dist, "assets", "app.js.br"), "br");
  writeFileSync(join(dist, "favicon.png"), "png");

  it("serves build files, preferring a precompressed copy the browser accepts", () => {
    expect(
      resolveStaticFile(dist, "GET", "/assets/app.js", "*/*", "gzip, br"),
    ).toMatchObject({
      contentEncoding: "br",
      contentType: "application/javascript",
      path: join(dist, "assets", "app.js.br"),
    });
    expect(
      resolveStaticFile(dist, "GET", "/favicon.png", "image/*", "gzip"),
    ).toMatchObject({
      contentEncoding: null,
      path: join(dist, "favicon.png"),
    });
  });

  it("falls back to index.html for page navigations only", () => {
    expect(
      resolveStaticFile(
        dist,
        "GET",
        "/projects/proj_1/threads/thr_1?x=1",
        "text/html,*/*",
        "",
      ),
    ).toMatchObject({ path: join(dist, "index.html"), urlPath: "/index.html" });
    expect(
      resolveStaticFile(dist, "GET", "/assets/missing.js", "text/html", ""),
    ).toBeNull();
    expect(resolveStaticFile(dist, "GET", "/sw.js", "*/*", "")).toBeNull();
  });

  it("leaves the API, mutations and paths outside the build to the server", () => {
    expect(
      resolveStaticFile(dist, "GET", "/api/v1/threads", "text/html", ""),
    ).toBeNull();
    expect(resolveStaticFile(dist, "GET", "/health", "*/*", "")).toBeNull();
    expect(
      resolveStaticFile(dist, "POST", "/index.html", "text/html", ""),
    ).toBeNull();
    expect(
      resolveStaticFile(dist, "GET", "/../outside.txt", "*/*", ""),
    ).toBeNull();
  });
});
