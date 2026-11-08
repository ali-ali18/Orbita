import type { ToolSchema } from "./model.ts";
import { READ_TOOLS } from "./read-tools.ts";
import { type Tool, toolSchema } from "./tool.ts";
import { WRITE_TOOLS } from "./write-tools.ts";

/** Todas as ferramentas, em ordem fixa (a ordem faz parte do prefixo em cache). */
export const ALL_TOOLS: readonly Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

export function toolSchemas(tools: readonly Tool[] = ALL_TOOLS): ToolSchema[] {
	return tools.map(toolSchema);
}

export function findTool(name: string, tools: readonly Tool[] = ALL_TOOLS): Tool | undefined {
	return tools.find((t) => t.name === name);
}
