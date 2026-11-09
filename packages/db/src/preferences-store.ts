import type { NotificationApp } from "@orbita/shared";

/** Perfil, preferências e notificações do dono: um único registro (app de um usuário só). */
export interface PreferencesRecord {
	/** Como a Órbita chama o dono; `null` = sem nome. */
	displayName: string | null;
	/** Conta já marcada em "Novo lançamento". */
	defaultAccountId: string | null;
	/** Escolhas da tela "Notificações do celular" (leitura das notificações de banco no Android). */
	notificationCapture: boolean;
	notificationApps: NotificationApp[];
	/** Guardar na lista "Não entendi" o que o parser não reconhece (desligado: descarta). */
	notificationToReview: boolean;
	/** O que o parser entendeu vai para "Para revisar" em vez de entrar direto como "aguardando o banco". */
	notificationAskFirst: boolean;
	/** Avisar quando o gasto passar deste percentual do limite (1 a 100). O push ainda não existe. */
	budgetAlertPercent: number;
	/** Conta que recebe a sobra do mês; `null` = nenhuma. Só a escolha é guardada: nada é movido. */
	leftoverAccountId: string | null;
	/** Meta ativa que recebe a sobra do mês; `null` = nenhuma. Nunca junto com `leftoverAccountId`. Só a escolha é guardada. */
	leftoverGoalId: string | null;
}

export type PreferencesPatch = Partial<PreferencesRecord>;

export const DEFAULT_PREFERENCES: PreferencesRecord = {
	displayName: null,
	defaultAccountId: null,
	notificationCapture: false,
	notificationApps: [],
	notificationToReview: true,
	notificationAskFirst: false,
	budgetAlertPercent: 80,
	leftoverAccountId: null,
	leftoverGoalId: null,
};

export interface PreferencesStore {
	/** Sempre devolve algo: sem registro ainda, são os padrões. */
	get(): Promise<PreferencesRecord>;
	/**
	 * Grava só os campos enviados e devolve o resultado. `invalid` para nome vazio/longo, app desconhecido ou percentual fora de 1 a 100;
	 * `bad_reference` para conta (padrão ou da sobra) ou meta da sobra que não existe ou está arquivada.
	 * Escolher conta da sobra desfaz a meta da sobra e vice-versa (`invalid` se o mesmo pedido manda as duas).
	 */
	update(patch: PreferencesPatch): Promise<PreferencesRecord>;
}
