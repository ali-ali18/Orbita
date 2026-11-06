import { hkdfSync } from "node:crypto";

export type KeyPurpose = "pairing-code" | "secret-box";

const SALT = "orbita/v1";
const KEY_BYTES = 32;

/**
 * Deriva uma chave independente por finalidade a partir do único `APP_SECRET`.
 * Assim um vazamento do HMAC dos códigos não entrega a chave que cifra os segredos.
 */
export function deriveKey(masterSecret: string, purpose: KeyPurpose): Buffer {
	return Buffer.from(hkdfSync("sha256", masterSecret, SALT, `orbita/${purpose}/v1`, KEY_BYTES));
}
