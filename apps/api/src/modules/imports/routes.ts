import { type CsvMapping, importStatement, previewStatement, StatementError } from "@orbita/ingest";
import { createRateLimiter } from "@orbita/security";
import { csvMappingBody, IMPORT_MAX_BYTES, idSchema } from "@orbita/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { apiError, defined } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";

/** O corpo é o arquivo (até 5 MB) mais os campos de texto do formulário. */
const MAX_REQUEST_BYTES = IMPORT_MAX_BYTES + 64 * 1024;

/**
 * Tipos MIME que um celular ou navegador costuma mandar para estes arquivos. É só uma primeira barreira: o tipo
 * vem do cliente, então o servidor confere o CONTEÚDO (`%PDF-`, cabeçalho OFX) de qualquer jeito.
 */
const ALLOWED_TYPES = new Set([
	"",
	"application/octet-stream",
	"text/csv",
	"text/plain",
	"text/comma-separated-values",
	"application/csv",
	"application/vnd.ms-excel",
	"application/x-csv",
	"application/pdf",
	"application/x-pdf",
	"application/x-ofx",
	"application/ofx",
	"application/vnd.intu.qfx",
	"text/ofx",
	"text/x-ofx",
	"text/xml",
	"application/xml",
]);

const STATEMENT_ERROR_HTTP = {
	empty: 400,
	unsupported: 415,
	encrypted: 422,
	too_large: 413,
	unreadable: 422,
} as const;

type Form = Record<string, string | File | (string | File)[]>;

const text = (form: Form, key: string): string | undefined => {
	const v = form[key];
	return typeof v === "string" && v !== "" ? v : undefined;
};

export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const clock = () => now().getTime();
	// Por aparelho: ler PDF custa CPU; o teto segura um laço de envios sem atrapalhar quem usa de verdade.
	const previewLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, now: clock });
	const importLimiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000, now: clock });
	const deps = { stores, now };

	/** Lê e valida o formulário. Devolve a resposta de erro pronta ou os dados. */
	async function readForm(parseBody: () => Promise<Form>) {
		let form: Form;
		try {
			form = await parseBody();
		} catch {
			return {
				error: apiError("dados_invalidos", "Não consegui ler o formulário enviado."),
				status: 400 as const,
			};
		}
		const file = form.file;
		if (!(file instanceof File)) {
			return { error: apiError("dados_invalidos", "Envie o arquivo do extrato."), status: 400 as const };
		}
		if (file.size === 0)
			return { error: apiError("dados_invalidos", "O arquivo está vazio."), status: 400 as const };
		if (file.size > IMPORT_MAX_BYTES) {
			return { error: apiError("corpo_grande", "O arquivo passa de 5 MB."), status: 413 as const };
		}
		const type = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
		if (!ALLOWED_TYPES.has(type)) {
			return {
				error: apiError("tipo_nao_aceito", "Formato não aceito. Envie um arquivo CSV, OFX ou PDF."),
				status: 415 as const,
			};
		}
		const accountId = text(form, "accountId");
		const cardId = text(form, "cardId");
		if ((accountId === undefined) === (cardId === undefined)) {
			return {
				error: apiError("dados_invalidos", "Informe a conta ou o cartão (apenas um dos dois)."),
				status: 400 as const,
			};
		}
		const id = idSchema.safeParse(accountId ?? cardId);
		if (!id.success) {
			return {
				error: apiError("dados_invalidos", "A conta ou o cartão informado é inválido."),
				status: 400 as const,
			};
		}
		let mapping: CsvMapping | undefined;
		const rawMapping = text(form, "mapping");
		if (rawMapping !== undefined) {
			let json: unknown;
			try {
				json = JSON.parse(rawMapping);
			} catch {
				json = null;
			}
			const parsed = csvMappingBody.safeParse(json);
			if (!parsed.success) {
				return {
					error: apiError(
						"dados_invalidos",
						parsed.error.issues[0]?.message ?? "As colunas escolhidas são inválidas.",
					),
					status: 400 as const,
				};
			}
			mapping = defined(parsed.data) as CsvMapping;
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		return {
			request: {
				bytes,
				filename: file.name.slice(0, 255),
				target: accountId !== undefined ? { accountId: id.data } : { cardId: id.data },
				options: {
					invertSign: text(form, "invertSign") === "true",
					...(mapping ? { mapping } : {}),
				},
				includePossibleDuplicates: text(form, "includePossibleDuplicates") === "true",
			},
		};
	}

	const tooBig = bodyLimit({
		maxSize: MAX_REQUEST_BYTES,
		onError: (c) => c.json(apiError("corpo_grande", "O arquivo passa de 5 MB."), 413),
	});

	/** Erros de arquivo (formato, senha, ilegível) viram resposta em pt-BR; o resto segue para o handler geral. */
	const guarded = async <T>(
		run: () => Promise<T>,
	): Promise<{ ok: true; value: T } | { ok: false; res: Response }> => {
		try {
			return { ok: true, value: await run() };
		} catch (error) {
			if (error instanceof StatementError) {
				return {
					ok: false,
					res: Response.json(apiError("arquivo_invalido", error.message), {
						status: STATEMENT_ERROR_HTTP[error.code],
					}),
				};
			}
			throw error;
		}
	};

	return new Hono<AppEnv>()
		.use("/v1/imports", requireDevice)
		.use("/v1/imports/*", requireDevice)
		.post(
			"/v1/imports/preview",
			rateLimit(previewLimiter, (c) => c.get("device").id),
			tooBig,
			async (c) => {
				const read = await readForm(() => c.req.parseBody() as Promise<Form>);
				if ("error" in read) return c.json(read.error, read.status);
				const result = await guarded(() => previewStatement(deps, read.request));
				return result.ok ? c.json(result.value) : result.res;
			},
		)
		.post(
			"/v1/imports",
			rateLimit(importLimiter, (c) => c.get("device").id),
			tooBig,
			async (c) => {
				const read = await readForm(() => c.req.parseBody() as Promise<Form>);
				if ("error" in read) return c.json(read.error, read.status);
				const result = await guarded(() => importStatement(deps, read.request));
				if (!result.ok) return result.res;
				const out = result.value;
				if (out.status === "in_progress") {
					return c.json(
						apiError("em_andamento", "Este arquivo ainda está sendo importado. Tente de novo em instantes."),
						409,
					);
				}
				if (out.status === "needs_mapping") return c.json(out.mapping);
				return c.json(out, out.status === "imported" ? 201 : 200);
			},
		);
}
