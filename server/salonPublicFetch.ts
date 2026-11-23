import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";

export type PublicAddress = { address: string; family: number };
export type PublicPageResponse = {
  status: number;
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
  body: string;
  finalUrl: string;
  requests: number;
};

export type SalonFetchRuntime = {
  resolve?: (hostname: string) => Promise<PublicAddress[]>;
  request?: (
    url: URL,
    address: PublicAddress,
    options: { timeoutMs: number; maxBytes: number; userAgent: string },
  ) => Promise<{ status: number; headers: PublicPageResponse["headers"]; body: string }>;
};

const MAX_PAGE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

function ipv4IsPublic(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c, d] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255 && c === 255 && d === 255));
}

function ipv6Words(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = value.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    value = `${value.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some(part => !/^[\da-f]{1,4}$/.test(part))) return null;
  return parts.map(part => parseInt(part, 16));
}

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4IsPublic(address);
  if (version !== 6) return false;
  const words = ipv6Words(address);
  if (!words) return false;
  if (words.every(word => word === 0) || words.slice(0, 7).every(word => word === 0) && words[7] === 1) return false;
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return ipv4IsPublic(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if ((words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2001 && (words[1] <= 0x01ff || words[1] === 0x0db8)) return false;
  return words[0] !== 0x2002 && words[0] !== 0x3fff;
}

function validateUrl(url: URL): void {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local")) {
    throw new Error("Only public HTTP(S) pages can be fetched");
  }
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !isPublicAddress(literal)) {
    throw new Error("The page resolves to a private or reserved network address");
  }
}

async function resolvePublic(url: URL, runtime: SalonFetchRuntime, deadlineAt: number): Promise<PublicAddress[]> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new Error("Public page request timed out");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await Promise.race([
      (runtime.resolve ?? (hostname => lookup(hostname, { all: true, verbatim: true })))(host),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error(
          Date.now() >= deadlineAt ? "Public page request timed out" : "Public page DNS lookup timed out",
        )), Math.min(remainingMs, 3_000));
      }),
    ]).finally(() => {
      if (dnsTimer) clearTimeout(dnsTimer);
    });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("The page resolves to a private or reserved network address");
  }
  return addresses;
}

function requestPinned(
  url: URL,
  address: PublicAddress,
  options: { deadlineAt: number; maxBytes: number; userAgent: string },
): Promise<{ status: number; headers: PublicPageResponse["headers"]; body: string }> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, value?: { status: number; headers: PublicPageResponse["headers"]; body: string }) => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const request = requester({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { Host: url.host, "User-Agent": options.userAgent, Accept: "text/html,application/xhtml+xml", Connection: "close" },
      ...(url.protocol === "https:" && !isIP(hostname) ? { servername: hostname } : {}),
    }, response => {
      const remainingMs = options.deadlineAt - Date.now();
      if (remainingMs <= 0) {
        response.destroy();
        request.destroy(new Error("Public page request timed out"));
        finish(new Error("Public page request timed out"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const contentLength = Number(response.headers["content-length"] || 0);
      if (contentLength > options.maxBytes) {
        response.destroy();
        const error = new Error("Page exceeded the size limit");
        request.destroy(error);
        finish(error);
        return;
      }
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > options.maxBytes) {
          const error = new Error("Page exceeded the size limit");
          response.destroy(error);
          request.destroy(error);
          finish(error);
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => finish(undefined, {
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
      response.on("error", error => finish(error));
    });
    const remainingMs = options.deadlineAt - Date.now();
    if (remainingMs <= 0) {
      request.destroy();
      finish(new Error("Public page request timed out"));
      return;
    }
    hardTimer = setTimeout(() => {
      const error = new Error("Public page request timed out");
      request.destroy(error);
      finish(error);
    }, remainingMs);
    request.setTimeout(remainingMs, () => request.destroy(new Error("Public page request timed out")));
    request.on("error", error => finish(error));
    request.end();
  });
}

function header(headers: PublicPageResponse["headers"], name: string): string | undefined {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  return Array.isArray(value) ? value[0] : value;
}

export async function fetchPublicPage(
  input: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    deadlineAt?: number;
    userAgent?: string;
    runtime?: SalonFetchRuntime;
    requestBudget?: { used: number; max: number };
    allowedHosts?: string[];
  } = {},
): Promise<PublicPageResponse> {
  const runtime = options.runtime ?? {};
  let current = new URL(input);
  let requests = 0;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadlineAt = Math.min(options.deadlineAt ?? Number.POSITIVE_INFINITY, Date.now() + timeoutMs);
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    validateUrl(current);
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new Error("Public page request timed out");
    const addresses = await resolvePublic(current, runtime, deadlineAt);
    if (options.requestBudget && options.requestBudget.used >= options.requestBudget.max) {
      throw new Error("Website crawl request limit reached");
    }
    if (options.requestBudget) options.requestBudget.used++;
    const requestOptions = {
      deadlineAt,
      maxBytes: options.maxBytes ?? MAX_PAGE_BYTES,
      userAgent: options.userAgent ?? "Mozilla/5.0 (compatible; TownGridCRM salon website review/1.0)",
    };
    const pendingResponse = runtime.request
      ? runtime.request(current, addresses[0], { timeoutMs: remainingMs, maxBytes: requestOptions.maxBytes, userAgent: requestOptions.userAgent })
      : requestPinned(current, addresses[0], requestOptions);
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      pendingResponse,
      new Promise<never>((_, reject) => {
        requestTimer = setTimeout(() => reject(new Error("Public page request timed out")), Math.max(1, deadlineAt - Date.now()));
      }),
    ]).finally(() => {
      if (requestTimer) clearTimeout(requestTimer);
    });
    requests++;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = header(response.headers, "location");
      if (!location) throw new Error(`Redirect from ${current.href} has no Location header`);
      if (redirect === maxRedirects) throw new Error("Website exceeded the redirect limit");
      const next = new URL(location, current);
      if (options.allowedHosts && !options.allowedHosts.some(host => host.toLowerCase().replace(/^www\./, "") === next.hostname.toLowerCase().replace(/^www\./, ""))) {
        throw new Error("Website redirected outside the submitted site");
      }
      current = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} fetching ${current.href}`);
    }
    const contentType = header(response.headers, "content-type");
    if (contentType && !/^\s*(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) {
      throw new Error(`Unsupported page content type ${contentType} at ${current.href}`);
    }
    if (Buffer.byteLength(response.body, "utf8") > (options.maxBytes ?? MAX_PAGE_BYTES)) {
      throw new Error("Page exceeded the size limit");
    }
    return { ...response, finalUrl: current.href, requests };
  }
  throw new Error("Website exceeded the redirect limit");
}