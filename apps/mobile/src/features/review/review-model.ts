import type { TransactionSource } from "@orbita/shared";
import type { IconName } from "../../ui/index.ts";

/**
 * Textos da tela Para revisar. O servidor já separa o que está pendente; aqui só se escolhe a frase.
 * Não há "juntar com outro lançamento": a API não aponta duplicata.
 */

export function reviewIntro(count: number, hasMore: boolean): string {
	const arrived = hasMore
		? `Pelo menos ${count} lançamentos chegaram sozinhos.`
		: count === 1
			? "1 lançamento chegou sozinho."
			: `${count} lançamentos chegaram sozinhos.`;
	return `${arrived} Confira antes de ${count === 1 && !hasMore ? "entrar" : "entrarem"} nos seus números.`;
}

export function reviewBannerTitle(count: number, hasMore: boolean): string {
	if (hasMore) return `${count} ou mais lançamentos para revisar`;
	if (count === 1) return "1 lançamento para revisar";
	return `${count} lançamentos para revisar`;
}

export function confirmAllLabel(count: number, hasMore: boolean): string {
	if (hasMore) return `Confirmar os ${count} carregados`;
	if (count === 1) return "Confirmar este";
	return `Confirmar os ${count} sem dúvida`;
}

/** De onde o lançamento veio, com o nome do banco quando a origem é a notificação ou o extrato. */
export function reviewOrigin(source: TransactionSource, place: string | null): string {
	switch (source) {
		case "notification":
			return place ? `Notificação do ${place}` : "Notificação";
		case "receipt":
			return "Comprovante compartilhado";
		case "pluggy":
			return place ? `Extrato do ${place}` : "Extrato do banco";
		case "import":
			return "Arquivo importado";
		case "manual":
			return "Lançado à mão";
		default: {
			const neverSource: never = source;
			return neverSource;
		}
	}
}

export function reviewSourceIcon(source: TransactionSource): IconName {
	switch (source) {
		case "notification":
			return "notificacao";
		case "receipt":
			return "escanear";
		case "pluggy":
			return "banco";
		case "import":
			return "baixar";
		case "manual":
			return "usuario";
		default: {
			const neverSource: never = source;
			return neverSource;
		}
	}
}
