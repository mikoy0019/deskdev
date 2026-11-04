// DeskDev Studio — Google grant cryptography (shared by the `google` and
// `admin-users` Edge Functions).
//
// Import-free on purpose: only WebCrypto, TextEncoder and atob/btoa, which
// exist in the Edge Runtime, Deno and Node, so the site's Vitest suite tests
// this file directly (site/src/app/api/google/googleShared.test.ts). The
// environment is passed in (`getEnv`) instead of read from Deno.env for the
// same reason.
//
// What it protects:
// - Stored refresh tokens (google_connections, google_workspace_link).
//   v1 "v1.<iv>.<ct>"        AES-256-GCM, key HKDF(GOOGLE_TOKEN_KEY,
//                            "deskdev/google/refresh-token/v1"), AAD = user id.
//                            Still READ, so nobody is logged out by v2.
//   v2 "v2.<kid>.<iv>.<ct>"  same cipher, key HKDF(keyring[kid],
//                            "deskdev/google/refresh-token/v2"),
//                            AAD = "v2|<kid>|<owner>". The key id travels with
//                            the token, so adding a new key and making it
//                            current does not strand tokens sealed with the
//                            old one; they are re-sealed on their next use (or
//                            all at once by the `rotate_tokens` action).
// - OAuth state: HMAC-SHA256, "<kid>.<body>.<sig>". Signed, not secret.
// - Short-lived blobs: the grant in flight between Google's callback and
//   `finish` ("g2.<kid>.<iv>.<ct>") and the browser-bound PKCE flow cookie
//   ("f1.<kid>.<iv>.<ct>"). Each purpose has its own derived key, so a state
//   signature can never decrypt a token and a flow cookie never passes for a
//   grant.
//
// Keyring (Supabase function secrets):
//   GOOGLE_TOKEN_KEYS   "k1:<base64>,k2:<base64>"  ≥ 32 random bytes each
//   GOOGLE_TOKEN_KEY_ID the kid new tokens are sealed with (default: the
//                       first entry of GOOGLE_TOKEN_KEYS, else "k0")
//   GOOGLE_TOKEN_KEY    the original single key. It stays readable as kid
//                       "k0" and is the only key v1 tokens were sealed with.
// A missing, malformed or unknown key is a KeyConfigError (callers answer
// 503 and delete nothing): a misconfigured secret must never look like an
// unreadable row, or callers would throw away good connections.

export type GetEnv = (name: string) => string | undefined;

/** The server's key secrets are missing or malformed. Never a reason to delete a grant. */
export class KeyConfigError extends Error {}

/** This sealed token cannot be opened with any configured key (garbled, or sealed for someone else). */
export class TokenUnreadable extends Error {}

/** Whose grant a sealed token is: bound into the ciphertext as additional data. */
export type TokenOwner = { kind: "user"; userId: string } | { kind: "workspace" };

export const LEGACY_KID = "k0";
const KID_RE = /^[A-Za-z0-9_-]{1,16}$/;
const MIN_KEY_BYTES = 32;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- base64url

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Built with `new Uint8Array(n)` (not Uint8Array.from) so the type is backed
 * by a plain ArrayBuffer, which is what WebCrypto's BufferSource accepts.
 * Throws on anything that is not base64 / base64url.
 */
export function fromB64url(s: string) {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) throw new Error("not base64");
  const clean = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean + "===".slice((clean.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Key material: typed from fromB64url so it stays ArrayBuffer-backed (WebCrypto's BufferSource). */
export type KeyBytes = ReturnType<typeof fromB64url>;

export function randomToken(bytes = 16): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---------------------------------------------------------------- PKCE (RFC 7636)

/** 32 random bytes → a 43-character verifier, inside RFC 7636's 43–128 range. */
export function pkceVerifier(): string {
  return randomToken(32);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return b64url(new Uint8Array(digest));
}

// ---------------------------------------------------------------- keyring

export interface Keyring {
  /** The kid new tokens, states and blobs are sealed with. */
  current: string;
  /** Raw key material by kid. */
  keys: Map<string, KeyBytes>;
  /** GOOGLE_TOKEN_KEY, the only key v1 tokens were sealed with (null when unset). */
  legacy: KeyBytes | null;
}

function decodeKey(raw: string, label: string): KeyBytes {
  let bytes: KeyBytes;
  try {
    bytes = fromB64url(raw.trim());
  } catch {
    throw new KeyConfigError(`${label} is not valid base64`);
  }
  if (bytes.length < MIN_KEY_BYTES) {
    throw new KeyConfigError(`${label} must be at least ${MIN_KEY_BYTES} random bytes, base64-encoded`);
  }
  return bytes;
}

/** Reads the keyring secrets. Throws KeyConfigError when they are unusable. */
export function parseKeyring(getEnv: GetEnv): Keyring {
  const keys = new Map<string, KeyBytes>();
  const legacyRaw = getEnv("GOOGLE_TOKEN_KEY")?.trim();
  const legacy = legacyRaw ? decodeKey(legacyRaw, "GOOGLE_TOKEN_KEY") : null;

  const listRaw = getEnv("GOOGLE_TOKEN_KEYS")?.trim();
  let first: string | null = null;
  if (listRaw) {
    for (const entry of listRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const i = entry.indexOf(":");
      const kid = i > 0 ? entry.slice(0, i).trim() : "";
      if (!KID_RE.test(kid)) throw new KeyConfigError("GOOGLE_TOKEN_KEYS entries must look like <kid>:<base64>");
      if (keys.has(kid)) throw new KeyConfigError(`GOOGLE_TOKEN_KEYS lists key id ${kid} twice`);
      keys.set(kid, decodeKey(entry.slice(i + 1), `GOOGLE_TOKEN_KEYS[${kid}]`));
      first ??= kid;
    }
  }
  // The original key stays readable under k0 unless the list redefines k0.
  if (legacy && !keys.has(LEGACY_KID)) keys.set(LEGACY_KID, legacy);
  if (!keys.size) throw new KeyConfigError("GOOGLE_TOKEN_KEYS (or GOOGLE_TOKEN_KEY) is not set");

  const wanted = getEnv("GOOGLE_TOKEN_KEY_ID")?.trim();
  const current = wanted || first || LEGACY_KID;
  if (!keys.has(current)) throw new KeyConfigError(`GOOGLE_TOKEN_KEY_ID ${current} is not in the keyring`);
  return { current, keys, legacy };
}

/** True when at least one key secret is set (it may still be malformed). */
export function keySecretsPresent(getEnv: GetEnv): boolean {
  return Boolean(getEnv("GOOGLE_TOKEN_KEYS")?.trim() || getEnv("GOOGLE_TOKEN_KEY")?.trim());
}

// ---------------------------------------------------------------- the crypto object

type Purpose = "token-v1" | "token-v2" | "state" | "grant" | "flow";

const INFO: Record<Purpose, string> = {
  "token-v1": "deskdev/google/refresh-token/v1",
  "token-v2": "deskdev/google/refresh-token/v2",
  state: "deskdev/google/oauth-state/v2",
  grant: "deskdev/google/pending-grant/v2",
  flow: "deskdev/google/browser-flow/v1",
};

const BLOB_PREFIX = { grant: "g2", flow: "f1" } as const;
export type BlobKind = keyof typeof BLOB_PREFIX;

export interface OpenedToken {
  token: string;
  /** Sealed as v1 or with a key that is no longer current: re-seal it. */
  stale: boolean;
}

function ownerAad(owner: TokenOwner): string {
  return owner.kind === "user" ? `user:${owner.userId}` : "workspace";
}

export class GoogleCrypto {
  readonly current: string;
  private readonly ring: Keyring;
  private readonly cache = new Map<string, Promise<CryptoKey>>();

  constructor(ring: Keyring) {
    this.ring = ring;
    this.current = ring.current;
  }

  static fromEnv(getEnv: GetEnv): GoogleCrypto {
    return new GoogleCrypto(parseKeyring(getEnv));
  }

  hasKid(kid: string): boolean {
    return this.ring.keys.has(kid);
  }

  private derive(material: KeyBytes, cacheKey: string, purpose: Purpose): Promise<CryptoKey> {
    const id = `${cacheKey}|${purpose}`;
    let p = this.cache.get(id);
    if (!p) {
      p = (async () => {
        const base = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
        const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(INFO[purpose]) };
        return purpose === "state"
          ? crypto.subtle.deriveKey(params, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"])
          : crypto.subtle.deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      })();
      this.cache.set(id, p);
    }
    return p;
  }

  private keyFor(kid: string, purpose: Purpose): Promise<CryptoKey> {
    const material = this.ring.keys.get(kid);
    if (!material) throw new KeyConfigError(`key id ${kid} is not in the keyring`);
    return this.derive(material, `kid:${kid}`, purpose);
  }

  private async gcmEncrypt(key: CryptoKey, plain: string, aad: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plain));
    return `${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
  }

  private async gcmDecrypt(key: CryptoKey, iv: string, ct: string, aad: string): Promise<string> {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(aad) },
      key,
      fromB64url(ct),
    );
    return dec.decode(pt);
  }

  // -------------------------------------------------------------- refresh tokens

  /** v2 with the current key. */
  async sealToken(token: string, owner: TokenOwner): Promise<string> {
    const kid = this.current;
    const body = await this.gcmEncrypt(await this.keyFor(kid, "token-v2"), token, `v2|${kid}|${ownerAad(owner)}`);
    return `v2.${kid}.${body}`;
  }

  /**
   * v1, only for google_connections while 027's CHECK still says LIKE 'v1.%'
   * (until a migration widens it to '^v[0-9]+\.'). Uses GOOGLE_TOKEN_KEY when
   * set, so a v1 token stays readable by an older deployment of the function.
   */
  async sealTokenV1(token: string, userId: string): Promise<string> {
    const material = this.ring.legacy ?? this.ring.keys.get(this.current)!;
    const key = await this.derive(material, this.ring.legacy ? "legacy" : `kid:${this.current}`, "token-v1");
    return `v1.${await this.gcmEncrypt(key, token, userId)}`;
  }

  /**
   * Opens a stored token. TokenUnreadable = garbled or sealed for another
   * owner (callers may delete the row); KeyConfigError = a key this token
   * needs is not configured (callers must answer 503 and keep the row).
   */
  async openToken(sealed: string, owner: TokenOwner): Promise<OpenedToken> {
    const parts = typeof sealed === "string" ? sealed.split(".") : [];
    if (parts[0] === "v2" && parts.length === 4) {
      const [, kid, iv, ct] = parts;
      if (!KID_RE.test(kid)) throw new TokenUnreadable("bad key id");
      const key = await this.keyFor(kid, "token-v2"); // KeyConfigError when the kid was removed
      try {
        return { token: await this.gcmDecrypt(key, iv, ct, `v2|${kid}|${ownerAad(owner)}`), stale: kid !== this.current };
      } catch {
        throw new TokenUnreadable("token does not decrypt");
      }
    }
    if (parts[0] === "v1" && parts.length === 3 && owner.kind === "user") {
      const [, iv, ct] = parts;
      // GOOGLE_TOKEN_KEY first (the key every v1 token was sealed with), then
      // the keyring, in case the owner moved that value into GOOGLE_TOKEN_KEYS.
      const candidates: [string, KeyBytes][] = [];
      if (this.ring.legacy) candidates.push(["legacy", this.ring.legacy]);
      for (const [kid, material] of this.ring.keys) candidates.push([`kid:${kid}`, material]);
      for (const [cacheKey, material] of candidates) {
        try {
          const key = await this.derive(material, cacheKey, "token-v1");
          return { token: await this.gcmDecrypt(key, iv, ct, owner.userId), stale: true };
        } catch {
          // try the next key
        }
      }
      throw new TokenUnreadable("token does not decrypt");
    }
    throw new TokenUnreadable("unrecognised token format");
  }

  // -------------------------------------------------------------- OAuth state (signed)

  async signState(payload: unknown): Promise<string> {
    const kid = this.current;
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign("HMAC", await this.keyFor(kid, "state"), enc.encode(`${kid}.${body}`));
    return `${kid}.${body}.${b64url(new Uint8Array(sig))}`;
  }

  /** The parsed payload, or null when forged, garbled or signed with a key we no longer hold. */
  async verifyState(raw: unknown): Promise<unknown | null> {
    if (typeof raw !== "string" || raw.length > 4000) return null;
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [kid, body, sig] = parts;
    if (!KID_RE.test(kid) || !this.ring.keys.has(kid)) return null;
    try {
      // verify() compares in constant time.
      const ok = await crypto.subtle.verify("HMAC", await this.keyFor(kid, "state"), fromB64url(sig), enc.encode(`${kid}.${body}`));
      return ok ? JSON.parse(dec.decode(fromB64url(body))) : null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------- short-lived sealed blobs

  async sealBlob(kind: BlobKind, payload: unknown): Promise<string> {
    const kid = this.current;
    const prefix = BLOB_PREFIX[kind];
    const body = await this.gcmEncrypt(await this.keyFor(kid, kind), JSON.stringify(payload), `${prefix}|${kid}`);
    return `${prefix}.${kid}.${body}`;
  }

  /** null = forged, garbled, of another kind, or sealed with a key we no longer hold. */
  async openBlob(kind: BlobKind, raw: unknown): Promise<unknown | null> {
    if (typeof raw !== "string" || raw.length > 8000) return null;
    const parts = raw.split(".");
    const prefix = BLOB_PREFIX[kind];
    if (parts.length !== 4 || parts[0] !== prefix) return null;
    const [, kid, iv, ct] = parts;
    if (!KID_RE.test(kid) || !this.ring.keys.has(kid)) return null;
    try {
      return JSON.parse(await this.gcmDecrypt(await this.keyFor(kid, kind), iv, ct, `${prefix}|${kid}`));
    } catch {
      return null;
    }
  }
}
