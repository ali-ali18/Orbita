import { type Cents, formatBRL, isValidLocalDate, type LocalDate, type MonthKey } from "@orbita/core";
import type { ChatRowsCard, ProposalKind } from "@orbita/shared";
import { z } from "zod";
import type { AgentReader, Catalog } from "./backend.ts";
import type { ToolSchema } from "./model.ts";

/** O que uma ferramenta enxerga ao rodar. */
export interface ToolContext {
	/** Hoje, no fuso de São Paulo (vem do relógio injetado). */
	today: LocalDate;
	/** Mês de hoje. */
	currentMonth: MonthKey;
	reader: AgentReader;
	/** Contas, cartões e categorias (lidos uma vez por turno). */
	catalog(): Promise<Catalog>;
}

/** Escrita proposta, ainda sem id: o loop a registra e devolve o id. */
export interface ProposalDraft {
	kind: ProposalKind;
	/** O que será executado, já validado (volta do banco na hora de confirmar). */
	payload: Record<string, unknown>;
	title: string;
	lines: Array<{ label: string; value: string }>;
}

export interface ToolOutput {
	/** O que o modelo recebe (JSON com centavos inteiros e textos já formatados). */
	data: Record<string, unknown>;
	/** O que o app desenha, se for o caso. */
	card?: ChatRowsCard;
	/** Escrita proposta (só as ferramentas `write`). */
	proposal?: ProposalDraft;
}

export interface Tool {
	name: string;
	/** "Consultando o resumo do mês…": o que o app mostra enquanto a ferramenta roda. */
	label: string;
	description: string;
	/** `write` nunca grava: devolve uma proposta que o dono confirma no card. */
	access: "read" | "write";
	input: z.ZodType;
	run(input: unknown, ctx: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodType>(def: {
	name: string;
	label: string;
	description: string;
	access: "read" | "write";
	input: S;
	run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
}): Tool {
	return { ...def, run: (input, ctx) => def.run(input as z.output<S>, ctx) };
}

/** JSON Schema da ferramenta, no formato da API da Anthropic. */
export function toolSchema(tool: Tool): ToolSchema {
	const json = z.toJSONSchema(tool.input, {
		target: "draft-7",
		unrepresentable: "any",
		io: "input",
	}) as Record<string, unknown>;
	const { $schema: _ignored, ...schema } = json;
	return {
		name: tool.name,
		description: tool.description,
		input_schema: { type: "object", additionalProperties: false, ...schema },
	};
}

// ----------------------------------------------------------- campos comuns

export const monthInput = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM.")
	.describe("Mês no formato AAAA-MM. Ausente = o mês atual.");

export const dateInput = z
	.string()
	.refine(isValidLocalDate, "Data no formato AAAA-MM-DD.")
	.describe("Data no formato AAAA-MM-DD.");

// ------------------------------------------------------------- formatação

/** Dinheiro para o modelo e para o card: centavos inteiros + texto pronto. */
export const money = (cents: Cents) => ({ cents, text: formatBRL(cents) });

/** Percentual com uma casa (`123` → "12,3%"), a partir de décimos inteiros. */
export function formatTenthsPercent(tenths: number): string {
	const sign = tenths < 0 ? "−" : "";
	const abs = Math.abs(tenths);
	const whole = Math.floor(abs / 10);
	const frac = abs % 10;
	return `${sign}${whole}${frac === 0 ? "" : `,${frac}`}%`;
}

/** Parte `part` de `total` em décimos de ponto percentual (inteiro, arredondado). `null` se `total` é zero. */
export function shareTenths(part: Cents, total: Cents): number | null {
	if (total === 0) return null;
	return Math.round((part * 1000) / total);
}

export function nameOf(items: ReadonlyArray<{ id: string; name: string }>, id: string | null): string | null {
	if (id === null) return null;
	return items.find((item) => item.id === id)?.name ?? null;
}
