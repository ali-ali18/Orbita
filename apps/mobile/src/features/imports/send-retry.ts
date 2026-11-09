/**
 * Repete o envio uma vez quando a conexão cai antes de qualquer resposta. O celular não repete sozinho um pedido
 * com arquivo (o corpo só pode ser lido uma vez), então quem refaz é o app, montando o corpo de novo.
 * Resposta do servidor, mesmo de erro, nunca repete: só a falha de transporte.
 */
export async function sendRetryingOnce<T>(send: () => Promise<T>): Promise<T> {
	try {
		return await send();
	} catch {
		return send();
	}
}
