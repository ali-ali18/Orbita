/*
 * Código que roda no NAVEGADOR do celular, dentro da página /pluggy/conectar (empacotado com o pluggy-connect-sdk
 * pelo servidor; ver assets.ts). Sem framework. Texto sempre por `textContent`, nunca HTML.
 *
 * Fluxo: lê o token da sessão do fragmento da URL e o apaga do histórico → pede o token do widget ao servidor →
 * abre o Pluggy Connect → no `onSuccess` manda o ID da conexão ao servidor, que confere e cadastra.
 */
import { PluggyConnect } from "pluggy-connect-sdk";

type View = "loading" | "idle" | "done" | "error";

function show(view: View, message?: string) {
	for (const el of document.querySelectorAll<HTMLElement>("[data-view]")) {
		el.hidden = el.dataset.view !== view;
	}
	if (message !== undefined) {
		for (const el of document.querySelectorAll<HTMLElement>("[data-message]")) {
			if (!el.closest("[hidden]")) el.textContent = message;
		}
	}
}

/** O token vem em `#s=<token>`: fragmento não vai para o servidor, para logs nem para o Referer. */
function takeSession(): string | null {
	const match = /^#s=([A-Za-z0-9_-]{43})$/.exec(location.hash);
	history.replaceState(null, "", location.pathname);
	return match?.[1] ?? null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			credentials: "omit",
			cache: "no-store",
		});
	} catch {
		throw new Error("Não consegui falar com o servidor. Confira a sua conexão e tente de novo.");
	}
	const data: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const message = (data as { error?: { message?: unknown } } | null)?.error?.message;
		throw new Error(typeof message === "string" ? message : "Algo deu errado. Volte ao app e tente de novo.");
	}
	return data as T;
}

const reason = (e: unknown) => (e instanceof Error ? e.message : "Algo deu errado.");

const session = takeSession();
let finished = false;
let lastProblem: string | null = null;

async function open() {
	if (!session) {
		show("error", "Este link não vale mais. Volte ao app e toque em Conectar banco de novo.");
		return;
	}
	show("loading");
	lastProblem = null;
	try {
		const { connectToken, updateItem } = await post<{ connectToken: string; updateItem?: string }>(
			"/pluggy/connect-token",
			{ session },
		);
		const widget = new PluggyConnect({
			connectToken,
			// Reconexão: abre o item que já existe (modo de atualização), sem criar outro.
			...(typeof updateItem === "string" ? { updateItem } : {}),
			// Bancos de teste ficam desligados: aqui só entra banco de verdade.
			includeSandbox: false,
			language: "pt",
			theme: "dark",
			onSuccess: async (data) => {
				if (finished) return;
				const itemId = data?.item?.id;
				if (typeof itemId !== "string") {
					lastProblem = "O Pluggy não devolveu a conexão. Tente de novo.";
					return;
				}
				finished = true;
				show("loading");
				try {
					await post("/pluggy/connect-complete", { session, itemId });
					show("done");
				} catch (e) {
					finished = false;
					show("error", reason(e));
				}
			},
			// Senha errada, pedido de código (MFA) que falhou, banco fora do ar: o widget segue aberto para tentar
			// de novo. Guardamos o motivo para mostrar se a pessoa fechar o widget.
			onError: () => {
				lastProblem = "O banco não conseguiu conectar. Confira os dados e tente de novo.";
			},
			onClose: () => {
				if (finished) return;
				show("idle", lastProblem ?? undefined);
			},
		});
		await widget.init();
	} catch (e) {
		show("error", reason(e));
	}
}

for (const el of document.querySelectorAll<HTMLElement>("[data-action=connect]")) {
	el.addEventListener("click", () => void open());
}
void open();
