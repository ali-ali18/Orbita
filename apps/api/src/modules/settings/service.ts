import type { SecretStore } from "@orbita/db";
import { createSecretBox } from "@orbita/security";
import type { SecretName, SecretStatusDto } from "@orbita/shared";
import { SECRET_NAMES } from "@orbita/shared";

export type SecretVaultDeps = {
	store: SecretStore;
	/** Chave derivada de `APP_SECRET` com `deriveKey(..., "secret-box")`. */
	key: Buffer;
};

/**
 * Cofre das chaves do servidor. Cifra com AES-GCM e amarra o texto ao nome da chave (AAD): copiar o
 * texto cifrado de uma chave para outra faz a abertura falhar.
 */
export function createSecretVault({ store, key }: SecretVaultDeps) {
	const box = createSecretBox(key);
	return {
		async put(name: SecretName, value: string): Promise<SecretStatusDto> {
			const saved = await store.put(name, box.seal(value, name));
			return { name, configured: true, updatedAt: saved.updatedAt.toISOString() };
		},

		/**
		 * O valor em claro, para o resto do servidor (worker do Pluggy, agentes). Nunca exposto por HTTP.
		 * `null` se a chave não foi cadastrada; lança se o texto não abre (APP_SECRET trocado ou dado adulterado).
		 */
		async read(name: SecretName): Promise<string | null> {
			const sealed = await store.get(name);
			return sealed === null ? null : box.open(sealed, name);
		},

		async remove(name: SecretName): Promise<SecretStatusDto> {
			await store.remove(name);
			return { name, configured: false, updatedAt: null };
		},

		/** As 3 chaves, na ordem fixa; só o estado, nunca o valor. */
		async status(): Promise<SecretStatusDto[]> {
			const byName = new Map((await store.list()).map((s) => [s.name, s.updatedAt]));
			return SECRET_NAMES.map((name) => {
				const updatedAt = byName.get(name);
				return { name, configured: updatedAt !== undefined, updatedAt: updatedAt?.toISOString() ?? null };
			});
		},
	};
}

export type SecretVault = ReturnType<typeof createSecretVault>;
