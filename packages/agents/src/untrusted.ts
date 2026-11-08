/*
 * Texto que vem de fora (descrição do banco, estabelecimento, observação, nome vindo de extrato) é DADO, nunca
 * instrução. Antes de chegar ao modelo ele é limpo: sem caracteres de controle nem quebras de linha, sem
 * marcações que imitam o formato de mensagem e com tamanho limitado. A limpeza não "neutraliza" uma frase
 * maliciosa (isso não existe); só tira o espaço que ela teria para parecer outra coisa que não dado.
 * A defesa de verdade é que a IA não tem ferramenta que mova dinheiro e que toda escrita pede confirmação.
 */

export const UNTRUSTED_MAX = 80;

// Controles C0/C1, espaços de largura zero, marcas de direção e separadores de linha/parágrafo.
// biome-ignore lint/suspicious/noControlCharactersInRegex: é exatamente o que se quer remover
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

export function untrusted(value: string | null | undefined, max = UNTRUSTED_MAX): string {
	if (!value) return "";
	const text = value
		.replace(CONTROL, " ")
		// Sem "<", ">" e crases: nada de falsas tags (`</tool_result>`, `<system>`) nem blocos de código.
		.replace(/[<>`]/g, "'")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
