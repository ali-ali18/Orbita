import { createHash } from "node:crypto";
import type { IdempotencyStore } from "@orbita/db";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { apiError } from "./errors.ts";
import type { AppEnv } from "./require-device.ts";

/** Quanto tempo a resposta de uma chave fica guardada: o suficiente para o app repetir o pedido depois de cair a rede. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
/** Reserva sem resposta há mais que isso é de um processo que caiu no meio: a chave pode ser retomada. */
export const IDEMPOTENCY_LOCK_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdempotencyDeps = { store: IdempotencyStore; now: () => Date };

/** JSON com as chaves em ordem: o mesmo conteúdo dá sempre o mesmo texto, não importa a ordem dos campos. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** Impressão digital do pedido: método, caminho e corpo. A mesma chave só vale para o mesmo pedido. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
	return createHash("sha256")
		.update(`${method} ${path}\n${canonicalJson(body)}`)
		.digest("hex");
}

const reply = (status: 400 | 409 | 422, code: string, message: string, headers?: Record<string, string>) =>
	new HTTPException(status, {
		res: Response.json(apiError(code, message), { status, ...(headers ? { headers } : {}) }),
	});

/**
 * Executa `run` no máximo uma vez por `Idempotency-Key`. Sem o cabeçalho, só executa (o app antigo continua
 * funcionando). Com ele:
 * - primeira vez: executa e guarda a resposta (`status` + o JSON de `run`);
 * - mesma chave e mesmo pedido: devolve a resposta guardada, sem executar;
 * - mesma chave com outro pedido: 422;
 * - mesma chave enquanto o primeiro pedido ainda roda: 409 (o app tenta de novo e recebe a resposta guardada).
 * Só sucesso fica guardado: se `run` falhar, a chave é liberada e a nova tentativa executa de novo.
 * Respostas que não são "o valor novo" saem como `HTTPException` com a resposta pronta.
 */
export async function idempotent<T>(
	c: Context<AppEnv>,
	deps: IdempotencyDeps,
	body: unknown,
	status: 200 | 201,
	run: () => Promise<T>,
): Promise<T> {
	const header = c.req.header("idempotency-key")?.trim();
	if (!header) return run();
	if (!UUID.test(header)) {
		throw reply(400, "chave_invalida", "O cabeçalho Idempotency-Key deve ser um UUID.");
	}
	const key = header.toLowerCase();
	const deviceId = c.get("device").id;
	const requestHash = requestFingerprint(c.req.method, c.req.path, body);
	const now = deps.now();

	const began = await deps.store.begin({
		key,
		deviceId,
		requestHash,
		now,
		expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
		staleBefore: new Date(now.getTime() - IDEMPOTENCY_LOCK_MS),
	});
	if (began.outcome === "existing") {
		const { record } = began;
		if (record.requestHash !== requestHash) {
			throw reply(
				422,
				"chave_reutilizada",
				"Essa chave já foi usada em outro lançamento. Tente salvar de novo para gerar uma chave nova.",
			);
		}
		if (record.status === null || record.body === null) {
			throw reply(
				409,
				"em_andamento",
				"Este lançamento ainda está sendo salvo. Tente de novo em instantes.",
				{
					"retry-after": "2",
				},
			);
		}
		throw new HTTPException(record.status as 200 | 201, {
			res: new Response(record.body, {
				status: record.status,
				headers: { "content-type": "application/json", "idempotent-replayed": "true" },
			}),
		});
	}

	let value: T;
	try {
		value = await run();
	} catch (e) {
		await deps.store.release({ key, deviceId });
		throw e;
	}
	// Se guardar a resposta falhar, a reserva fica: o erro 500 não esconde que o lançamento já foi criado, e
	// repetir logo em seguida cai em "em andamento" em vez de duplicar.
	await deps.store.complete({ key, deviceId, status, body: JSON.stringify(value) });
	return value;
}
