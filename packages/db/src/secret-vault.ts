import { createSecretBox } from "@orbita/security";
import type { SecretName, SecretStatusDto } from "@orbita/shared";
import { SECRET_NAMES } from "@orbita/shared";
import type { SecretStore } from "./secret-store.ts";

export type SecretVaultDeps = {
	store: SecretStore;
	/** Chave derivada de `APP_SECRET` com `deriveKey(..., "secret-box")`. */
	key: Buffer;
};

/**
 * Mora no db (e não na API) porque a API e o worker abrem o mesmo cofre: apps não importam apps.
 * Cofre das chaves do servidor. Cifra com AES-GCM e amarra o texto ao nome da chave (AAD): copiar o
 * texto cifrado de uma chave para outra faz a abertura falhar.
 */
export function createSecretVault({ store, key }: SecretVaultDeps) {
	const box = createSecretBox(key);
	async function canOpen(name: SecretName): Promise<boolean> {
		const sealed = await store.get(name);
		if (sealed === null) return false;
		try {
			box.open(sealed, name);
			return true;
		} catch {
			return false;
		}
	}
	return {
		async put(name: SecretName, value: string, updatedBy: string): Promise<SecretStatusDto> {
			const saved = await store.put(name, box.seal(value, name), updatedBy);
			return { name, configured: true, readable: true, updatedAt: saved.updatedAt.toISOString(), updatedBy };
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
			return { name, configured: false, readable: false, updatedAt: null, updatedBy: null };
		},

		/**
		 * As 3 chaves, na ordem fixa; só o estado, nunca o valor. `readable` diz se o texto cifrado ainda abre
		 * (some quando o `APP_SECRET` muda). O valor aberto é descartado na hora e nunca vai a log.
		 */
		async status(): Promise<SecretStatusDto[]> {
			const byName = new Map((await store.list()).map((s) => [s.name, s]));
			return Promise.all(
				SECRET_NAMES.map(async (name): Promise<SecretStatusDto> => {
					const row = byName.get(name);
					if (!row) return { name, configured: false, readable: false, updatedAt: null, updatedBy: null };
					return {
						name,
						configured: true,
						readable: await canOpen(name),
						updatedAt: row.updatedAt.toISOString(),
						updatedBy: row.updatedBy,
					};
				}),
			);
		},
	};
}

export type SecretVault = ReturnType<typeof createSecretVault>;
