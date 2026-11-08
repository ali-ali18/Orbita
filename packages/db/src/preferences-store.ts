import type { NotificationApp } from "@orbita/shared";

/** Perfil, preferências e notificações do dono: um único registro (app de um usuário só). */
export interface PreferencesRecord {
	/** Como a Órbita chama o dono; `null` = sem nome. */
	displayName: string | null;
	/** Conta já marcada em "Novo lançamento". */
	defaultAccountId: string | null;
	/** Escolhas da tela "Notificações do celular". A captura ainda não existe: são só preferências guardadas. */
	notificationCapture: boolean;
	notificationApps: NotificationApp[];
	notificationToReview: boolean;
}

export type PreferencesPatch = Partial<PreferencesRecord>;

export const DEFAULT_PREFERENCES: PreferencesRecord = {
	displayName: null,
	defaultAccountId: null,
	notificationCapture: false,
	notificationApps: [],
	notificationToReview: true,
};

export interface PreferencesStore {
	/** Sempre devolve algo: sem registro ainda, são os padrões. */
	get(): Promise<PreferencesRecord>;
	/**
	 * Grava só os campos enviados e devolve o resultado. `invalid` para nome vazio/longo ou app desconhecido;
	 * `bad_reference` para conta que não existe ou está arquivada.
	 */
	update(patch: PreferencesPatch): Promise<PreferencesRecord>;
}
