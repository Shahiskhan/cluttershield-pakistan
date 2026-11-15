export type CandidateIndicatorType = "domain" | "url" | "phone_number";

export interface NormalizedIndicator {
  type: CandidateIndicatorType;
  canonical: string;
  masked: string;
  original: string;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split(".").map(Number);
    if (octets.some((n) => n > 255)) return true;
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  return false;
}

function normalizeWebIndicator(type: "domain" | "url", original: string): NormalizedIndicator {
  const candidate = original.includes("://") ? original : `https://${original}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("invalid_indicator");
  }
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("invalid_indicator");
  }
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateOrLocalHost(parsed.hostname)) throw new Error("invalid_indicator");
  if (type === "domain") {
    if (parsed.port || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
      throw new Error("invalid_indicator");
    }
    return { type, canonical: parsed.hostname, masked: parsed.hostname, original };
  }
  parsed.hash = "";
  parsed.search = "";
  return { type, canonical: `${parsed.origin}${parsed.pathname}`, masked: parsed.hostname, original };
}

export function normalizeIndicator(typeValue: unknown, valueValue: unknown): NormalizedIndicator {
  if (typeof typeValue !== "string" || typeof valueValue !== "string") throw new Error("invalid_indicator");
  const original = valueValue.trim();
  if (original.length < 3 || original.length > 2048 || /[\u0000-\u001f\u007f]/.test(original)) {
    throw new Error("invalid_indicator");
  }
  if (typeValue === "domain" || typeValue === "url") return normalizeWebIndicator(typeValue, original);
  if (typeValue === "phone_number") {
    let canonical = original.replace(/[\s().-]/g, "");
    if (/^0\d{10}$/.test(canonical)) canonical = "+92" + canonical.slice(1);
    else if (/^3\d{9}$/.test(canonical)) canonical = "+92" + canonical;
    else if (/^92\d{10}$/.test(canonical)) canonical = "+" + canonical;
    if (!/^\+[1-9]\d{7,14}$/.test(canonical)) throw new Error("invalid_indicator");
    return { type: "phone_number", canonical, masked: `••••${canonical.slice(-2)}`, original };
  }
  throw new Error("unsupported_indicator_type");
}

