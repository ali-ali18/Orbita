export interface StoredSecret {
	name: string;
	updatedAt: Date;
}

/**
 * Segredos do servidor (chaves de API) já cifrados. O store só enxerga texto cifrado: quem
 * cifra e decifra é o serviço da API. Nada aqui guarda nem devolve parte do valor em claro.
 */
export interface SecretStore {
	/** Cria ou troca o texto cifrado do segredo. */
	put(name: string, ciphertext: string): Promise<StoredSecret>;
	/** Texto cifrado, ou `null` se o segredo não foi cadastrado. */
	get(name: string): Promise<string | null>;
	/** Só nome e data; nunca o texto cifrado. Ordenado pelo nome. */
	list(): Promise<StoredSecret[]>;
	/** `true` se existia. */
	remove(name: string): Promise<boolean>;
}
