/** Quanto esperar o servidor responder ao pedido de revogação antes de desistir (e sair mesmo assim). */
export const REVOKE_TIMEOUT_MS = 4000;

export const NOT_NOTIFIED_MESSAGE =
	"Não consegui avisar o servidor. Desconecte este aparelho por lá, em Configurações → Servidor e chaves.";
export const SESSION_ENDED_MESSAGE = "Sua sessão terminou. Conecte de novo com um código novo.";

/**
 * Avisa o servidor que este aparelho saiu (`DELETE /v1/devices/current`). Melhor esforço: rede fora do
 * ar, erro ou demora viram `notified: false`, e quem chamou sai localmente do mesmo jeito.
 * 401 conta como avisado: o servidor já não reconhece o token.
 */
export async function revokeOnServer(
	request: () => Promise<{ status: number }>,
	timeoutMs: number = REVOKE_TIMEOUT_MS,
): Promise<{ notified: boolean }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), timeoutMs);
	});
	try {
		const res = await Promise.race([request().catch(() => null), timeout]);
		if (!res) return { notified: false };
		return { notified: res.status === 204 || res.status === 200 || res.status === 401 };
	} finally {
		clearTimeout(timer);
	}
}
