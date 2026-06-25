import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyHash: string;
}

export function encryptSecret(plaintext: string, encryptionKey: string): EncryptedSecret {
  const key = normalizeKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyHash: createHash("sha256").update(key).digest("hex").slice(0, 16)
  };
}

export function decryptSecret(secret: EncryptedSecret, encryptionKey: string): string {
  const key = normalizeKey(encryptionKey);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function normalizeKey(value: string): Buffer {
  if (!value || value.length < 16) throw new Error("encryption_key_too_short");
  return createHash("sha256").update(value).digest();
}

