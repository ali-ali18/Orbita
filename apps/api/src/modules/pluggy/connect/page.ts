import { colors, radius } from "@orbita/tokens";
import { secureHeaders } from "hono/secure-headers";

type ContentSecurityPolicyOptions = NonNullable<Parameters<typeof secureHeaders>[0]>["contentSecurityPolicy"];

/** O app abre este endereço (Expo Router, scheme "orbita" do app.json) quando a pessoa toca em voltar. */
export const APP_RETURN_URL = "orbita://configuracoes/bancos";

/**
 * Política de conteúdo da página. Só o próprio servidor, mais o que o Pluggy Connect exige:
 * - `frame-src https://connect.pluggy.ai`: o widget é um iframe desse endereço (CONNECT_PRODUCTION_URL no SDK 2.15.0);
 * - `style-src 'unsafe-inline'`: o SDK injeta `<style>` por `innerHTML` (modal e carregando), sem nonce;
 * - `script-src 'self'`: só o bundle do servidor, nenhum script inline e nenhum domínio de terceiro;
 * - `connect-src 'self'`: o navegador só fala com o Órbita (quem fala com a API do Pluggy é o servidor).
 */
export const CONNECT_PAGE_CSP: ContentSecurityPolicyOptions = {
	defaultSrc: ["'none'"],
	scriptSrc: ["'self'"],
	styleSrc: ["'self'", "'unsafe-inline'"],
	imgSrc: ["'self'", "data:"],
	connectSrc: ["'self'"],
	frameSrc: ["https://connect.pluggy.ai"],
	baseUri: ["'none'"],
	formAction: ["'none'"],
	frameAncestors: ["'none'"],
	objectSrc: ["'none'"],
};

/**
 * Cabeçalhos da página e das rotas `/pluggy/*`: CSP, `no-referrer`, `DENY` contra embutir a página, `nosniff` e
 * sem cache. O COOP fica de fora de propósito: o widget abre janelas (login do banco, Open Finance) e `same-origin`
 * cortaria a ligação com elas.
 */
export const connectSecureHeaders = secureHeaders({
	contentSecurityPolicy: CONNECT_PAGE_CSP,
	referrerPolicy: "no-referrer",
	xFrameOptions: "DENY",
	crossOriginOpenerPolicy: false,
	permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
});

const CSS = `
:root{color-scheme:dark;--bg:${colors.background};--surface:${colors.surface};--surface2:${colors.surface2};--text:${colors.text};--muted:${colors.textSecondary};--accent:${colors.accent};--on-accent:${colors.onAccent};--r:${radius.card}px}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/20px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{min-height:100dvh;display:flex;flex-direction:column;justify-content:center;gap:24px;padding:32px 20px;max-width:420px;margin:0 auto}
h1{margin:0;font-size:30px;line-height:34px;font-weight:600;letter-spacing:-1px}
p{margin:0;color:var(--muted)}
[hidden]{display:none!important}
section{display:flex;flex-direction:column;gap:12px}
.btn{display:flex;align-items:center;justify-content:center;min-height:52px;border:0;border-radius:999px;padding:0 24px;font:600 15px system-ui,sans-serif;background:var(--accent);color:var(--on-accent);text-decoration:none;cursor:pointer}
.btn:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.btn.secondary{background:var(--surface2);color:var(--text)}
.dot{width:28px;height:28px;border-radius:50%;border:3px solid var(--surface2);border-top-color:var(--text);animation:spin 1s linear infinite}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
@keyframes spin{to{transform:rotate(360deg)}}
`;

/** Página estática em pt-BR. O script é externo (CSP sem inline); o texto dinâmico entra por `textContent`. */
export function renderConnectPage(scriptPath: string): string {
	return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="${colors.background}">
<title>Conectar banco · Órbita</title>
<style>${CSS}</style>
</head>
<body>
<main>
<section data-view="loading" role="status" aria-live="polite">
<div class="dot" aria-hidden="true"></div>
<h1>Conectar banco</h1>
<p>Abrindo o Pluggy…</p>
</section>
<section data-view="idle" hidden>
<h1>Conectar banco</h1>
<p data-message>Escolha o seu banco e entre com segurança pelo Pluggy.</p>
<button class="btn" type="button" data-action="connect">Conectar banco</button>
</section>
<section data-view="done" hidden role="status" aria-live="polite">
<h1>Pronto!</h1>
<p>O banco foi conectado. Volte para o app: a primeira sincronização já começou.</p>
<a class="btn" href="${APP_RETURN_URL}">Voltar para o Órbita</a>
</section>
<section data-view="error" hidden role="alert">
<h1>Não deu certo</h1>
<p data-message></p>
<button class="btn secondary" type="button" data-action="connect">Tentar de novo</button>
</section>
</main>
<script src="${scriptPath}"></script>
</body>
</html>
`;
}
