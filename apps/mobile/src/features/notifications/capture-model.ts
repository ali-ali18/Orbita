import {
	NOTIFICATION_APP_LABELS,
	NOTIFICATION_APPS_VERIFIED,
	NOTIFICATION_BANK_PACKAGES,
	type NotificationApp,
	type NotificationInboxReason,
} from "@orbita/shared";

/** Lógica pura da leitura de notificações no celular: o que ligar no serviço nativo e o que dizer ao dono. */

/** O que o módulo nativo informa (espelho de `CaptureStatus`, sem importar o módulo nativo para dentro dos testes). */
export interface NativeStatus {
	granted: boolean;
	queued: number;
	lastSentAt: number;
	lastError: string | null;
	authFailed: boolean;
}

/** Pacotes Android dos bancos ligados. O serviço nativo ainda confere contra a própria lista fixa. */
export const packagesFor = (apps: readonly NotificationApp[]): string[] =>
	apps.flatMap((app) => [...NOTIFICATION_BANK_PACKAGES[app]]);

/** Bancos com formato conferido contra notificações reais; os outros usam as regras genéricas e podem errar mais. */
export const isVerifiedApp = (app: NotificationApp): boolean => NOTIFICATION_APPS_VERIFIED.includes(app);

export type CaptureStage =
	/** Web, iOS ou APK antigo, sem o módulo: não dá para ler notificação. */
	| "unsupported"
	| "off"
	/** Ligada no app, mas o Android ainda não deu o acesso. */
	| "needs_access"
	/** Acesso dado, mas nenhum banco escolhido. */
	| "needs_bank"
	| "active";

export interface CaptureView {
	stage: CaptureStage;
	/** Linha de destaque da tela. */
	title: string;
	detail: string;
	/** Chama atenção (aviso) em vez de só informar. */
	alert: boolean;
}

/**
 * O estado da leitura, juntando o que o servidor guarda (ligada, bancos) com o que só o aparelho sabe (acesso dado,
 * fila). `status === null` com `supported` é só a primeira leitura ainda em andamento.
 */
export function captureView(input: {
	supported: boolean;
	capture: boolean;
	apps: readonly NotificationApp[];
	status: NativeStatus | null;
}): CaptureView {
	const { supported, capture, apps, status } = input;
	if (!supported) {
		return {
			stage: "unsupported",
			title: "Só no app Android",
			detail:
				"A leitura das notificações dos bancos usa um recurso do Android e precisa do APK mais novo do Órbita. Aqui você só ajusta as escolhas.",
			alert: true,
		};
	}
	if (!capture) {
		return {
			stage: "off",
			title: "Leitura desligada",
			detail: "Ligue para as compras dos bancos entrarem na hora, sem esperar o Open Finance.",
			alert: false,
		};
	}
	if (status !== null && !status.granted) {
		return {
			stage: "needs_access",
			title: "Falta liberar o acesso no Android",
			detail: "O Android pede que você mesmo ligue o Órbita em Acesso a notificações. Toque no botão abaixo.",
			alert: true,
		};
	}
	if (apps.length === 0) {
		return {
			stage: "needs_bank",
			title: "Escolha ao menos um banco",
			detail: "Só leio os apps de banco que você ligar na lista abaixo.",
			alert: true,
		};
	}
	const many = apps.length === 1 ? "1 banco" : `${apps.length} bancos`;
	return {
		stage: "active",
		title: `Lendo as notificações de ${many}`,
		detail: "Cada compra vira um lançamento na hora, mesmo com o app fechado.",
		alert: false,
	};
}

/** Linha sobre o envio: fila esperando rede, último envio ou problema. `null` quando não há nada a dizer. */
export function deliveryLine(status: NativeStatus | null, now: number): string | null {
	if (status === null) return null;
	if (status.authFailed) return "O servidor não reconhece mais este aparelho. Saia e entre de novo no app.";
	const queued =
		status.queued === 0
			? null
			: status.queued === 1
				? "1 notificação espera rede para ir ao servidor."
				: `${status.queued} notificações esperam rede para ir ao servidor.`;
	if (queued !== null) return status.lastError ? `${queued} ${status.lastError}` : queued;
	if (status.lastSentAt > 0) return `Último envio ${ago(now - status.lastSentAt)}.`;
	return null;
}

/** "agora há pouco", "há 5 min", "há 3 h", "há 2 dias". */
export function ago(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	if (minutes < 1) return "agora há pouco";
	if (minutes < 60) return `há ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `há ${hours} h`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export const INBOX_REASON_LABEL: Record<NotificationInboxReason, string> = {
	format: "Não entendi o formato",
	target: "Não achei o cartão ou a conta",
};

/** Legenda de uma notificação da lista: banco, motivo e horário. */
export function inboxCaption(
	item: { app: NotificationApp; reason: NotificationInboxReason; postedAt: string },
	now: number,
): string {
	const when = Date.parse(item.postedAt);
	const parts = [NOTIFICATION_APP_LABELS[item.app], INBOX_REASON_LABEL[item.reason]];
	if (Number.isFinite(when)) parts.push(ago(now - when));
	return parts.join(" · ");
}

/** Como chegar ao botão que libera o acesso quando o Android o bloqueia (APK instalado fora da loja, Android 13+). */
export const RESTRICTED_SETTINGS_HELP =
	"Se a chave aparecer esmaecida, abra Informações do app, toque nos três pontos e em Permitir configurações restritas. Depois volte e ligue o Órbita.";
