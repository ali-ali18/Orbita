import { PLUGGY_FIRST_SYNC_DAYS, type PluggyConnectionDto, type PluggyStatusResponse } from "@orbita/shared";
import { connectionName } from "./banks-model.ts";

/*
 * "Conectar banco · Pronto" (Figma 53:1254): a tela de sucesso depois do Pluggy Connect. Aparece quando a conexão
 * nova chega e a primeira sincronização termina. Só mostra números que o servidor sabe.
 */

export const CONNECTED_LATER = "Ver depois";

/** A primeira conexão que não existia quando a página do Pluggy foi aberta. */
export function newConnection(
	before: readonly string[],
	connections: readonly PluggyConnectionDto[],
): PluggyConnectionDto | null {
	const known = new Set(before);
	return connections.find((c) => !known.has(c.id)) ?? null;
}

/**
 * Hora de mostrar os números: nada em andamento e a conexão trouxe dado (ok ou parcial) com ao menos uma conta ou
 * cartão. Conexão que o banco ainda não preencheu não é "conectado, trouxe os últimos dias": fica na lista, com a
 * situação dela na legenda.
 */
export function isReadyToCelebrate(
	connection: Pick<PluggyConnectionDto, "lastStatus" | "summary">,
	sync: PluggyStatusResponse["sync"],
): boolean {
	return (
		sync === "idle" &&
		(connection.lastStatus === "ok" || connection.lastStatus === "partial") &&
		connection.summary.accounts + connection.summary.cards > 0
	);
}

export function connectedTitle(connection: Pick<PluggyConnectionDto, "label">): string {
	return `${connectionName(connection)} conectado`;
}

const DAYS_PER_MONTH = 30.44;

/** "6 meses": o tempo que a primeira sincronização busca (`PLUGGY_FIRST_SYNC_DAYS`, o mesmo número do servidor). */
export function firstSyncSpanText(days: number = PLUGGY_FIRST_SYNC_DAYS): string {
	const months = Math.max(1, Math.round(days / DAYS_PER_MONTH));
	return months === 1 ? "1 mês" : `${months} meses`;
}

export const CONNECTED_SUBTITLE = `Trouxe os últimos ${firstSyncSpanText()}. Já separei em categorias.`;

/** Rótulo do total de lançamentos do Pluggy: com mais de uma conexão ele soma todas, então não diz "importados". */
export const IMPORTED_ROW_LABEL = "Lançamentos importados";
export const IMPORTED_ALL_BANKS_LABEL = "Lançamentos de todos os bancos";

export interface ConnectedRow {
	label: string;
	value: number;
}

/** Linhas da tabela. Contas e cartões só aparecem se vieram; lançamentos e pendentes sempre (zero também é resposta). */
export function connectedRows(input: {
	summary: PluggyConnectionDto["summary"];
	/** Total de lançamentos do Pluggy no Órbita: soma TODAS as conexões, não só a nova. */
	imported: number | null;
	pending: number | null;
	/** Quantas conexões do Pluggy existem. Mais de uma: o total não é só desta, e o rótulo diz isso. */
	connections?: number;
}): ConnectedRow[] {
	const rows: ConnectedRow[] = [];
	if (input.summary.accounts > 0) {
		rows.push({ label: input.summary.accounts === 1 ? "Conta" : "Contas", value: input.summary.accounts });
	}
	if (input.summary.cards > 0) {
		rows.push({ label: input.summary.cards === 1 ? "Cartão" : "Cartões", value: input.summary.cards });
	}
	if (input.imported !== null) {
		const label = (input.connections ?? 1) > 1 ? IMPORTED_ALL_BANKS_LABEL : IMPORTED_ROW_LABEL;
		rows.push({ label, value: input.imported });
	}
	if (input.pending !== null) rows.push({ label: "Para você revisar", value: input.pending });
	return rows;
}

/** "Revisar os 3"; sem nada para revisar o botão principal é "Ver o Início". */
export function connectedPrimary(pending: number | null): { label: string; target: "review" | "home" } {
	if (pending === null || pending === 0) return { label: "Ver o Início", target: "home" };
	return { label: pending === 1 ? "Revisar 1" : `Revisar os ${pending}`, target: "review" };
}
