/** Only serialized HTTP(S) origins are accepted; never infer trust from Host. */
export function parseAllowedOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("server.allowed_origins must be an array of HTTP(S) origins");
  return [...new Set(value.map((origin: unknown) => {
    if (typeof origin !== "string") throw new Error("Invalid allowed origin");
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("Invalid allowed origin"); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.hostname.includes('*')) {
      throw new Error("Allowed origins must be exact HTTP(S) origins without paths, credentials or wildcards");
    }
    return origin;
  }))];
}

export function isAllowedVoiceOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}
