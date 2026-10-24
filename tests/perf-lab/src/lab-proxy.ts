import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import http2, {
  type Http2ServerRequest,
  type Http2ServerResponse,
} from "node:http2";
import net, { type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";

const CONNECTION_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "host",
  "http2-settings",
  "keep-alive",
  "proxy-connection",
  "te",
  "transfer-encoding",
  "upgrade",
]);

export type LabTransport = "h1" | "h2";

export interface RouteDelay {
  ms: number;
  pattern: RegExp;
  source: string;
}

export interface LabProxyOptions {
  appDist: string | null;
  backendUrl: string;
  delays: readonly RouteDelay[];
  transport: LabTransport;
}

const STATIC_MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "application/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const PRECOMPRESSED_ENCODINGS = [
  { encoding: "br", extension: ".br" },
  { encoding: "gzip", extension: ".gz" },
] as const;

interface StaticFile {
  contentEncoding: string | null;
  contentType: string;
  path: string;
  urlPath: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function resolveStaticFile(
  appDist: string,
  method: string,
  url: string,
  acceptHeader: string,
  acceptEncodingHeader: string,
): StaticFile | null {
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }
  const pathname = decodeURIComponent(
    new URL(url, "http://lab.invalid").pathname,
  );
  if (pathname.startsWith("/api/") || pathname === "/health") {
    return null;
  }
  const root = resolve(appDist);
  const requested = resolve(
    root,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    return null;
  }
  let path = requested;
  let urlPath = pathname;
  if (!isFile(path)) {
    if (
      pathname.startsWith("/assets/") ||
      !acceptHeader.includes("text/html")
    ) {
      return null;
    }
    path = join(root, "index.html");
    urlPath = "/index.html";
  }
  const contentType =
    STATIC_MIME_TYPES[extname(path)] ?? "application/octet-stream";
  for (const candidate of PRECOMPRESSED_ENCODINGS) {
    if (
      acceptEncodingHeader.includes(candidate.encoding) &&
      isFile(`${path}${candidate.extension}`)
    ) {
      return {
        contentEncoding: candidate.encoding,
        contentType,
        path: `${path}${candidate.extension}`,
        urlPath,
      };
    }
  }
  return { contentEncoding: null, contentType, path, urlPath };
}

function staticCacheControl(urlPath: string): string {
  if (urlPath.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  return urlPath.endsWith(".html") ? "no-cache" : "public, max-age=3600";
}

export interface LabProxy {
  close: () => Promise<void>;
  url: string;
}

export function parseRouteDelay(value: string): RouteDelay {
  const separator = value.lastIndexOf("=");
  const glob = value.slice(0, separator);
  const ms = Number(value.slice(separator + 1));
  if (separator <= 0 || !Number.isInteger(ms) || ms < 0) {
    throw new Error(
      `--delay expects <path glob>=<ms>, e.g. "/api/v1/environments/*/status*=1500"; got ${value}`,
    );
  }
  const escaped = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return { ms, pattern: new RegExp(`^${escaped}$`, "u"), source: value };
}

export function resolveRouteDelay(
  delays: readonly RouteDelay[],
  method: string,
  path: string,
): number {
  let total = 0;
  for (const delay of delays) {
    if (delay.pattern.test(path) || delay.pattern.test(`${method} ${path}`)) {
      total += delay.ms;
    }
  }
  return total;
}

function createCertificate(): { cert: Buffer; key: Buffer } {
  const directory = mkdtempSync(join(tmpdir(), "bb-perf-lab-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    return {
      cert: readFileSync(join(directory, "cert.pem")),
      key: readFileSync(join(directory, "key.pem")),
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function endToEndHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (
      value !== undefined &&
      !name.startsWith(":") &&
      !CONNECTION_HEADERS.has(name)
    ) {
      result[name] = value;
    }
  }
  return result;
}

export async function startLabProxy(
  options: LabProxyOptions,
): Promise<LabProxy> {
  const backend = new URL(options.backendUrl);
  const backendPort = Number(
    backend.port || (backend.protocol === "https:" ? 443 : 80),
  );
  const server: Server =
    options.transport === "h2"
      ? http2.createSecureServer({ allowHTTP1: true, ...createCertificate() })
      : http.createServer();
  const sockets = new Set<Socket>();
  let publicOrigin = "";

  const upstreamHeaders = (
    headers: IncomingHttpHeaders,
  ): OutgoingHttpHeaders => {
    const result = endToEndHeaders(headers);
    if (result["origin"] === publicOrigin) {
      result["origin"] = backend.origin;
    }
    result["host"] = backend.host;
    return result;
  };

  server.on(
    options.transport === "h2" ? "secureConnection" : "connection",
    (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    },
  );

  server.on(
    "request",
    (
      request: Http2ServerRequest | IncomingMessage,
      response: Http2ServerResponse | ServerResponse,
    ) => {
      const forward = () => {
        const upstream = http.request(
          {
            headers: upstreamHeaders(request.headers),
            host: backend.hostname,
            method: request.method,
            path: request.url,
            port: backendPort,
          },
          (upstreamResponse) => {
            response.writeHead(
              upstreamResponse.statusCode ?? 502,
              endToEndHeaders(upstreamResponse.headers),
            );
            upstreamResponse.pipe(response);
          },
        );
        upstream.on("error", () => {
          if (!response.headersSent) {
            response.writeHead(502);
          }
          response.end();
        });
        request.pipe(upstream);
      };
      const staticFile =
        options.appDist === null
          ? null
          : resolveStaticFile(
              options.appDist,
              request.method ?? "GET",
              request.url ?? "/",
              String(request.headers.accept ?? ""),
              String(request.headers["accept-encoding"] ?? ""),
            );
      if (staticFile !== null) {
        const body = readFileSync(staticFile.path);
        response.writeHead(200, {
          "cache-control": staticCacheControl(staticFile.urlPath),
          "content-length": body.byteLength,
          "content-type": staticFile.contentType,
          ...(staticFile.contentEncoding === null
            ? {}
            : {
                "content-encoding": staticFile.contentEncoding,
                vary: "accept-encoding",
              }),
        });
        if (request.method === "HEAD") {
          response.end();
        } else {
          response.end(body);
        }
        return;
      }
      const delayMs = resolveRouteDelay(
        options.delays,
        request.method ?? "GET",
        request.url ?? "/",
      );
      if (delayMs > 0) {
        request.pause();
        setTimeout(() => {
          request.resume();
          forward();
        }, delayMs);
        return;
      }
      forward();
    },
  );

  server.on(
    "upgrade",
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const upstream = net.connect(backendPort, backend.hostname, () => {
        const headerLines = Object.entries(
          upstreamHeaders(request.headers),
        ).flatMap(([name, value]) =>
          (Array.isArray(value) ? value : [String(value)]).map(
            (item) => `${name}: ${item}`,
          ),
        );
        upstream.write(
          [
            `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/1.1`,
            ...headerLines,
            "connection: Upgrade",
            `upgrade: ${request.headers.upgrade ?? "websocket"}`,
            "",
            "",
          ].join("\r\n"),
        );
        if (head.length > 0) {
          upstream.write(head);
        }
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The lab proxy is not listening on a TCP port.");
  }
  publicOrigin = `${options.transport === "h2" ? "https" : "http"}://127.0.0.1:${address.port}`;
  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
    url: publicOrigin,
  };
}
