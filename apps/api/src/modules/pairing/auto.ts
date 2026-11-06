import type { PairingGuard } from "./guard.ts";
import { createPairingCode, PAIRING_MAX_ATTEMPTS, type PairingDeps } from "./service.ts";

/**
 * Quem sobe o servidor por um painel (Dokploy) não tem terminal para rodar `parear`.
 * Enquanto não houver aparelho conectado, o servidor mantém um código válido e o
 * mostra no log, que o painel exibe.
 */
export async function ensurePairingCode(
	deps: PairingDeps,
): Promise<{ code: string; expiresAt: Date } | null> {
	if ((await deps.store.countActiveDevices()) > 0) return null;
	if (await deps.store.findActivePairingCode(deps.now(), PAIRING_MAX_ATTEMPTS)) return null;
	return createPairingCode(deps);
}

export function formatPairingBanner(code: string, expiresAt: Date): string {
	const hora = expiresAt.toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "America/Sao_Paulo",
	});
	const bar = "=".repeat(52);
	return [
		"",
		bar,
		"  ÓRBITA — pareamento",
		"",
		`        CÓDIGO:  ${code.slice(0, 3)} ${code.slice(3)}`,
		"",
		`  Vale até ${hora} (horário de Brasília), uma vez só.`,
		"  Digite este código no app. Se ninguém conectar em 10 minutos, eu gero outro.",
		bar,
		"",
	].join("\n");
}

export type AutoPairingLog = { info(message: string): void; error(message: string, err?: unknown): void };

export function startAutoPairing({
	deps,
	guard,
	log,
	intervalMs = 30_000,
}: {
	deps: PairingDeps;
	guard: PairingGuard;
	log: AutoPairingLog;
	intervalMs?: number;
}): () => void {
	let running = false;
	let pausedLogged = false;
	const tick = async () => {
		// Evita rodadas sobrepostas se o banco estiver lento.
		if (running) return;
		running = true;
		try {
			// Palpites errados demais: não oferece código novo (e novos palpites) até a janela virar.
			if (guard.status().paused) {
				if (!pausedLogged) {
					log.info(
						"Pareamento automático pausado: muitas tentativas erradas na última hora. Volto a gerar códigos quando a janela passar.",
					);
					pausedLogged = true;
				}
				return;
			}
			pausedLogged = false;
			const created = await ensurePairingCode(deps);
			if (created) log.info(formatPairingBanner(created.code, created.expiresAt));
		} catch (err) {
			log.error("Falha ao gerar o código de pareamento automático.", err);
		} finally {
			running = false;
		}
	};

	void tick();
	const timer = setInterval(() => void tick(), intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}
