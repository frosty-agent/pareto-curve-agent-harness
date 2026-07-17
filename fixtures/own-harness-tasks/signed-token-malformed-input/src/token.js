import { createHmac, timingSafeEqual } from "node:crypto";

export function signToken(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifySignedToken(token, secret) {
  const [encodedPayload, encodedSignature] = token.split(".");
  const expected = createHmac("sha256", secret).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (!timingSafeEqual(actual, expected)) return null;
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
}
