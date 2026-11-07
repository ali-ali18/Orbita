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
}

export type UpdateRunResult =
	| "disabled"
	| "no-server"
	| "other-server"
	| "throttled"
	| "up-to-date"
	| "downloaded"
	| "error";

const DEFAULT_MIN_INTERVAL_MS = 15 * 60_000;

/** `true` se o servidor pareado é o mesmo host (e porta) do endereço de atualização embutido no APK. */
export function isSameServer(baseUrl: string, otaUpdateUrl: string | null): boolean {
	if (!otaUpdateUrl) return false;
	try {
		return new URL(baseUrl).host.toLowerCase() === new URL(otaUpdateUrl).host.toLowerCase();
	} catch {
		return false;
	}
}

/**
 * Confere se há atualização e a baixa. A atualização baixada roda na PRÓXIMA abertura do app: nunca
 * recarregamos no meio do uso. Não lança: uma falha de atualização não pode derrubar o app.
 */
export function createUpdateChecker(
	port: UpdatesPort,
	opts: { now?: () => number; minIntervalMs?: number; otaUpdateUrl: string | null },
) {
	const now = opts.now ?? Date.now;
	const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
	let lastRunAt: number | null = null;
	let inFlight: Promise<UpdateRunResult> | null = null;

	async function work(baseUrl: string | null): Promise<UpdateRunResult> {
		if (!port.isEnabled) return "disabled";

		// Sem servidor pareado, ou pareado com outro que não o do APK: não checa.
		if (baseUrl === null) return "no-server";
		if (!isSameServer(baseUrl, opts.otaUpdateUrl)) return "other-server";

		if (lastRunAt !== null && now() - lastRunAt < minInterval) return "throttled";
		lastRunAt = now();

		if (!(await port.check()).isAvailable) return "up-to-date";
		return (await port.download()).isNew ? "downloaded" : "up-to-date";
	}

	return {
		/** Chamado ao abrir o app e ao voltar ao primeiro plano. Chamadas simultâneas dividem a mesma execução. */
		run(baseUrl: string | null): Promise<UpdateRunResult> {
			inFlight ??= work(baseUrl)
				.catch((): UpdateRunResult => "error")
				.finally(() => {
					inFlight = null;
				});
			return inFlight;
		},
	};
}
