function decodeSecret(name: string): Uint8Array {
  const value = Deno.env.get(name);
  if (!value) throw new Error("server_configuration");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("server_configuration");
  }
  if (bytes.byteLength !== 32) throw new Error("server_configuration");
  return bytes;
}

export async function protectIndicator(original: string, canonical: string) {
  const encryptionKey = await crypto.subtle.importKey(
    "raw", decodeSecret("INDICATOR_ENCRYPTION_KEY"), { name: "AES-GCM" }, false, ["encrypt"],
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw", decodeSecret("INDICATOR_HMAC_KEY"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ original, canonical }));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey, plaintext));
  const ciphertext = new Uint8Array(iv.length + encrypted.length);
  ciphertext.set(iv, 0);
  ciphertext.set(encrypted, iv.length);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(canonical)));
  const hex = (input: Uint8Array) => [...input].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const keyVersion = Deno.env.get("INDICATOR_HMAC_KEY_VERSION") ?? "v1";
  if (!/^[a-zA-Z0-9_-]{1,24}$/.test(keyVersion)) throw new Error("server_configuration");
  return { ciphertextBytea: `\\x${hex(ciphertext)}`, hashBytea: `\\x${hex(hash)}`, keyVersion };
}

