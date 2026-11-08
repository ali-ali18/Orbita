const ACCEPT = {
	receipt: "image/*,.pdf",
	photo: "image/*",
} as const;

/**
 * Abre o seletor de arquivo do navegador. No aplicativo nativo ainda não há seletor:
 * devolve `null` e quem chamou explica isso.
 */
export function pickLocalFile(kind: keyof typeof ACCEPT): Promise<boolean> {
	if (typeof document === "undefined") return Promise.resolve(false);
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ACCEPT[kind];
		let settled = false;
		const finish = (picked: boolean) => {
			if (settled) return;
			settled = true;
			input.remove();
			resolve(picked);
		};
		input.addEventListener("change", () => finish((input.files?.length ?? 0) > 0));
		input.addEventListener("cancel", () => finish(false));
		document.body.appendChild(input);
		input.click();
	});
}
