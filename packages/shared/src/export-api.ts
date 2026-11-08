import { z } from "zod";

/*
 * Exportar tudo (`GET /v1/export`). Dinheiro continua em centavos inteiros no JSON; no CSV vira texto
 * brasileiro ("-46,90"). O que entra é escolhido por `include`; o período, por `from`/`to` (só afeta lançamentos).
 */

export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_DATASETS = ["transactions", "categories", "accounts", "subscriptions"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export const EXPORT_DATASET_LABELS: Record<ExportDataset, string> = {
	transactions: "Lançamentos",
	categories: "Categorias",
	accounts: "Contas e cartões",
	subscriptions: "Assinaturas",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use datas no formato AAAA-MM-DD.");

/** `include` chega como lista separada por vírgula (`?include=transactions,categories`); sai na ordem fixa. */
const includeList = z
	.string()
	.transform((v) => v.split(",").filter((s) => s !== ""))
	.pipe(
		z
			.array(z.enum(EXPORT_DATASETS, { error: "Dado desconhecido para exportar." }))
			.min(1, "Escolha o que exportar."),
	)
	.transform((list) => EXPORT_DATASETS.filter((d) => list.includes(d)));

export const exportQuery = z
	.object({
		format: z.enum(EXPORT_FORMATS, { error: "Formato desconhecido. Use csv ou json." }),
		/** Padrão: só os lançamentos. */
		include: includeList.optional(),
		from: isoDate.optional(),
		to: isoDate.optional(),
	})
	.refine((q) => !q.from || !q.to || q.from <= q.to, "A data inicial vem antes da final.");
export type ExportQuery = z.infer<typeof exportQuery>;
