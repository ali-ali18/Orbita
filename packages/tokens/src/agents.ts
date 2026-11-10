import { chart } from "./chart.ts";
import { colors } from "./colors.ts";

/**
 * Cada agente tem uma cor (a do rosto) e um tom escuro da mesma cor para o fundo do cartão dele. A cor vem da
 * paleta dos gráficos; o tom é a cor a 14% sobre o fundo preto (hex fixo, para não depender de opacidade).
 * A Órbita é branca, como o avatar dela. Agente criado pelo dono usa `custom`.
 */
export const agents = {
	orbita: { color: colors.text, tint: colors.surface },
	vigia: { color: chart.orange, tint: "#1E0C05" },
	fechamento: { color: chart.blue, tint: "#081320" },
	metas: { color: chart.yellow, tint: "#1C1300" },
	caca_assinatura: { color: chart.magenta, tint: "#1E0B12" },
	cofrinho: { color: chart.aqua, tint: "#041610" },
	economia: { color: chart.lime, tint: "#141B09" },
	custom: { color: chart.violet, tint: "#110D24" },
} as const;

export type AgentVisualKey = keyof typeof agents;
