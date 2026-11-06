import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type SecretBox = {
	/** Cifra com IV aleatório. `aad` amarra o texto cifrado a um registro (ex.: "setting:anthropic_key"). */
	seal(plaintext: string, aad?: string): string;
	/** Lança Error se o texto foi adulterado, a chave ou o `aad` não batem, ou a versão é desconhecida. */
	open(sealed: string, aad?: string): string;
};

/** AES-256-GCM para segredos em repouso (chaves de API, tokens de terceiros). */
export function createSecretBox(key: Buffer): SecretBox {
	if (key.length !== 32) throw new Error("A chave do cofre precisa ter 32 bytes.");

	return {
		seal(plaintext, aad) {
			const iv = randomBytes(IV_BYTES);
			const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
			if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
			const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
			const tag = cipher.getAuthTag();
			return [VERSION, iv.toString("base64url"), data.toString("base64url"), tag.toString("base64url")].join(
				".",
			);
		},

		open(sealed, aad) {
			const parts = sealed.split(".");
			if (parts.length !== 4) throw new Error("Segredo cifrado em formato inválido.");
			const [version, ivB64, dataB64, tagB64] = parts as [string, string, string, string];
			if (version !== VERSION) throw new Error(`Versão de segredo cifrado desconhecida: ${version}.`);

			const iv = Buffer.from(ivB64, "base64url");
			const tag = Buffer.from(tagB64, "base64url");
			if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
				throw new Error("Segredo cifrado em formato inválido.");
			}
			try {
				const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
				if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
				decipher.setAuthTag(tag);
				return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString(
					"utf8",
				);
			} catch {
				// Mensagem única: não revela se falhou a chave, o aad ou o conteúdo.
				throw new Error("Não foi possível abrir o segredo: chave errada ou dado adulterado.");
			}
		},
	};
}
