/*
 * Atualização OTA do app (docs/servidor.md, "Atualizar o app sem APK").
 *
 * O endereço das atualizações é fixo no APK (`updates.url`, vindo de ORBITA_PUBLIC_URL no build), então as
 * proteções anti-bricking do expo-updates continuam ligadas. Aqui o app só decide se vale conferir: apenas
 * quando o servidor pareado é o mesmo host do APK. O que protege contra código estranho é a assinatura do
 * manifesto, conferida pelo expo-updates contra o certificado embutido no APK.
 *
 * A lógica fica separada do `expo-updates` (a porta `UpdatesPort`) para ser testada sem o módulo nativo.
 */

export interface UpdatesPort {
	/** `false` em dev, na web e em APK sem certificado: tudo abaixo vira um não-fazer-nada. */
	readonly isEnabled: boolean;
	check(): Promise<{ isAvailable: boolean }>;
	download(): Promise<{ isNew: boolean }>;
	/** Reinicia o JavaScript já na atualização baixada (o app volta para a primeira tela). */
	reload(): Promise<void>;
}

export type UpdateRunResult =
	| "disabled"
	| "no-server"
	| "other-server"
	| "throttled"
	| "up-to-date"
	| "downloaded"
	| "error";

/** A última checagem de verdade (um "throttled" não entra aqui). `at` em ms desde 1970. */
export type UpdateCheckRecord = {
	result: Exclude<UpdateRunResult, "throttled">;
	at: number;
	error: string | null;
};

export type UpdateCheckerState = {
	last: UpdateCheckRecord | null;
	/** Há uma atualização baixada esperando o app reiniciar para entrar em uso. */
	pending: boolean;
};

const DEFAULT_MIN_INTERVAL_MS = 15 * 60_000;
/** Depois de uma falha (servidor reiniciando, sem rede) a próxima tentativa não espera os 15 minutos. */
const DEFAULT_ERROR_RETRY_MS = 60_000;

/** `true` se o servidor pareado é o mesmo host (e porta) do endereço de atualização embutido no APK. */
export function isSameServer(baseUrl: string, otaUpdateUrl: string | null): boolean {
	if (!otaUpdateUrl) return false;
	try {
		return new URL(baseUrl).host.toLowerCase() === new URL(otaUpdateUrl).host.toLowerCase();
	} catch {
		return false;
	}
}

function messageOf(e: unknown): string {
	const text = e instanceof Error ? e.message : String(e);
	return text.slice(0, 300);
}

/**
 * Confere se há atualização e a baixa. A atualização baixada entra em uso quando o JavaScript reinicia:
 * `applyPending()` faz isso num momento seguro (o app voltando do segundo plano), porque no Android "abrir o
 * app de novo" quase nunca é um início a frio e a atualização ficaria baixada sem nunca aparecer.
 * Não lança: uma falha de atualização não pode derrubar o app.
 */
export function createUpdateChecker(
	port: UpdatesPort,
	opts: { now?: () => number; minIntervalMs?: number; errorRetryMs?: number; otaUpdateUrl: string | null },
) {
	const now = opts.now ?? Date.now;
	const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
	const errorRetry = Math.min(opts.errorRetryMs ?? DEFAULT_ERROR_RETRY_MS, minInterval);
	let nextAllowedAt: number | null = null;
	let inFlight: Promise<UpdateRunResult> | null = null;
	let last: UpdateCheckRecord | null = null;
	let pending = false;
	let applying = false;

	async function work(baseUrl: string | null, force: boolean): Promise<UpdateRunResult> {
		if (!port.isEnabled) return "disabled";

		// Sem servidor pareado, ou pareado com outro que não o do APK: não checa.
		if (baseUrl === null) return "no-server";
		if (!isSameServer(baseUrl, opts.otaUpdateUrl)) return "other-server";

		if (!force && nextAllowedAt !== null && now() < nextAllowedAt) return "throttled";
		nextAllowedAt = now() + minInterval;

		try {
			if (!(await port.check()).isAvailable) return "up-to-date";
			if (!(await port.download()).isNew) return "up-to-date";
		} catch (e) {
			nextAllowedAt = now() + errorRetry;
			throw e;
		}
		pending = true;
		return "downloaded";
	}

	function record(result: UpdateRunResult, error: string | null): UpdateRunResult {
		if (result !== "throttled") last = { result, at: now(), error };
		return result;
	}

	return {
		/**
		 * Chamado ao abrir o app e ao voltar ao primeiro plano. Chamadas simultâneas dividem a mesma execução.
		 * `force` (o botão "Procurar atualização agora") ignora o intervalo mínimo.
		 */
		run(baseUrl: string | null, runOpts: { force?: boolean } = {}): Promise<UpdateRunResult> {
			inFlight ??= work(baseUrl, runOpts.force === true)
				.then(
					(result) => record(result, null),
					(e: unknown) => record("error", messageOf(e)),
				)
				.finally(() => {
					inFlight = null;
				});
			return inFlight;
		},

		/**
		 * Se há atualização baixada, reinicia o JavaScript para ela entrar em uso. `true` se pediu o reinício.
		 * Não lança; se o reinício falhar, a atualização continua pendente e entra no próximo início a frio.
		 */
		async applyPending(): Promise<boolean> {
			if (!pending || applying || !port.isEnabled) return false;
			applying = true;
			try {
				await port.reload();
				return true;
			} catch {
				return false;
			} finally {
				applying = false;
			}
		},

		state(): UpdateCheckerState {
			return { last, pending };
		},
	};
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
