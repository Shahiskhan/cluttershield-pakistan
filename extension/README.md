# Chrome extension starter

The Manifest V3 extension checks pasted links and phone numbers locally. Optional navigation protection can be enabled by the user; it checks top-level destinations against the verified local cache and redirects matches to a local warning page. Destination URLs and browsing history are never sent to the service. The extension does not read page contents.

Before loading the extension:

1. The checked-in `config.js` and `manifest.json` intentionally contain no project endpoint or key. Add the deployment feed endpoint, host permission, and verification public key only to a private release copy; do not commit project-specific configuration or signing private keys.
2. Add the registered 32-byte Ed25519 public key to `verificationKeys`, using the same `key_id` published by the server. Never add the signing private key.
3. Apply the feed release migration, configure server signing secrets, and publish a release using `compile-feed` as a platform admin.

The verified snapshot envelope uses `schema_version`, `feed_version`, `generated_at`, `valid_until`, `key_id`, `algorithm: "Ed25519"`, `metadata`, `items`, `payload_sha256`, and `signature`. The payload hash and signature are computed over canonical UTF-8 JSON containing metadata and items, with object keys recursively sorted. The client rejects expired, malformed, incorrectly signed, or rolled-back releases and keeps a last-known-good feed for at most 48 hours after expiry. Manual URL and Pakistan/international phone checks run locally; checked values are not transmitted.

The verification key list is intentionally empty until the deployment's public key is registered and configured. The extension therefore reports unavailable protection until a valid signed release can be verified. Unknown and new scams may not appear in the feed.
