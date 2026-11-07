export type PluggyErrorCode =
	| "auth" // client id/secret recusados
	| "forbidden"
	| "not_found"
	| "rate_limit"
	| "unavailable" // 5xx
	| "http" // outro status
	| "timeout"
	| "network"
	| "too_large"
	| "invalid_response";

/**
 * Erro do Pluggy já pronto para o dono ler: pt-BR, sem chave, sem token e sem corpo bruto da resposta.
 * `message` pode ir para o banco (`lastError`) e para a API.
 */
export class PluggyError extends Error {
	readonly code: PluggyErrorCode;
	readonly status: number | undefined;
	constructor(code: PluggyErrorCode, message: string, status?: number) {
		super(message);
		this.name = "PluggyError";
		this.code = code;
		this.status = status;
	}
}

const MESSAGES: Record<PluggyErrorCode, string> = {
	auth: "O Pluggy recusou o Client ID e o Client Secret. Confira as chaves em Servidor e chaves.",
	forbidden: "O Pluggy não deixou acessar esta conexão. Confira se o ID pertence à sua conta.",
	not_found: "O Pluggy não achou esta conexão. Confira o ID.",
	rate_limit: "O Pluggy pediu para esperar um pouco (limite de pedidos). Tente de novo mais tarde.",
	unavailable: "O Pluggy está fora do ar agora. Tente de novo mais tarde.",
	http: "O Pluggy respondeu com um erro inesperado.",
	timeout: "O Pluggy demorou demais para responder.",
	network: "Não deu para falar com o Pluggy (rede).",
	too_large: "A resposta do Pluggy veio grande demais e foi descartada.",
	invalid_response: "O Pluggy respondeu em um formato que o Órbita não entende.",
};

export function pluggyError(code: PluggyErrorCode, status?: number): PluggyError {
	return new PluggyError(code, MESSAGES[code], status);
}

/**
 * Mensagem segura de qualquer erro para gravar/mostrar: `PluggyError` já é; o resto vira texto genérico
 * (o detalhe pode citar corpo de resposta, URL ou chave).
 */
export function safeErrorMessage(error: unknown): string {
	return error instanceof PluggyError ? error.message : "Falhou ao sincronizar com o Pluggy.";
}
