/** Cores da interface (tema escuro). Hex em maiúsculas, 6 dígitos. */
export const colors = {
	background: "#000000",
	surface: "#141414",
	surface2: "#1F1F1F",
	surface3: "#2A2A2A",
	border: "#262626",
	text: "#FFFFFF",
	textSecondary: "#8F8F8F",
	textTertiary: "#5A5A5A",
	/** Dinheiro que entra (receita, estorno, pagamento de fatura). Só em valor de dinheiro; ver styleguide. */
	positive: "#34D17A",
	/** Ação destrutiva ("Remover" no menu do widget): texto e ícone, sempre junto de um rótulo. Nunca em valor de dinheiro. */
	danger: "#FF6B6B",
	/** A cor primária (accent/onAccent) não é fixa: vem do tema escolhido, ver `accent.ts`. */
} as const;
