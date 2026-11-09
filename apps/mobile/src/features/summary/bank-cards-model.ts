import { formatAgo } from "../banks/banks-model.ts";

/*
 * Textos dos cards que usam os números do banco (Saldo em contas, Limite, Fluxo de caixa, Gasto do mês). Os valores
 * vêm prontos da API; aqui só se escolhe palavra, sinal e idade da leitura.
 */

/** "atualizado há 5 min" (discreto, ao lado de números que vieram do banco). `null` se nunca foi lido. */
export function freshnessLabel(iso: string | null, now: Date): string | null {
	const ago = iso ? formatAgo(iso, now) : null;
	if (!ago) return null;
	return ago === "agora" ? "atualizado agora" : `atualizado ${ago}`;
}

/** "1 conta", "3 contas". */
export function accountsCountLabel(count: number): string {
	return count === 1 ? "1 conta" : `${count} contas`;
}

/** Percentual para mostrar: até uma casa, vírgula, sem ",0" ("12,5%", "8%"). */
export function formatPercent(value: number): string {
	const text = (Math.round(Math.abs(value) * 10) / 10).toFixed(1).replace(".", ",");
	return `${text.replace(/,0$/, "")}%`;
}

export interface Variation {
	arrow: "↓" | "↑" | "=";
	/** "↓ 12,5% vs mês anterior". */
	text: string;
	/** Para leitor de tela: "12,5% a menos que no mês anterior, até o mesmo dia". */
	spoken: string;
}

/**
 * Variação do gasto contra o mês anterior até o mesmo dia (já calculada no servidor). Gastar menos é seta para
 * baixo; sem base (mês anterior sem gasto até aquele dia) o texto diz isso em vez de inventar um número.
 */
export function variation(percent: number | null): Variation {
	if (percent === null) {
		return { arrow: "=", text: "Sem mês anterior para comparar", spoken: "Sem mês anterior para comparar" };
	}
	if (percent === 0) {
		return { arrow: "=", text: "= igual ao mês anterior", spoken: "Igual ao mês anterior, até o mesmo dia" };
	}
	const down = percent < 0;
	return {
		arrow: down ? "↓" : "↑",
		text: `${down ? "↓" : "↑"} ${formatPercent(percent)} vs mês anterior`,
		spoken: `${formatPercent(percent)} ${down ? "a menos" : "a mais"} que no mês anterior, até o mesmo dia`,
	};
}

/** Quantas vezes: "1 vez", "3 vezes". */
export function timesLabel(count: number): string {
	return count === 1 ? "1 vez" : `${count} vezes`;
}

/** De onde vem o "usado" do limite, em uma frase curta. */
export function limitSourceLabel(source: "bank" | "estimated" | "none"): string {
	switch (source) {
		case "bank":
			return "Informado pelo banco";
		case "estimated":
			return "Estimado pelo Órbita";
		case "none":
			return "Limite não informado";
	}
}
