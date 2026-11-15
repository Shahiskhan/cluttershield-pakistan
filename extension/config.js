// Fill this file only in a private release build. Keep project endpoints,
// publishable keys, and verification keys out of the public source repository.
// Never place FEED_SIGNING_PRIVATE_KEY_PKCS8 in this extension.
self.CLUTTERSHIELD_CONFIG = Object.freeze({
  feedUrl: "",
  publishableKey: "",
  refreshMinutes: 60,
  maxStaleHours: 48,
  verificationKeys: Object.freeze({
    // "feed-key-id": "base64-encoded-32-byte-Ed25519-public-key"
  }),
});
