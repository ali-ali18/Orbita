import { deviceNameSchema, displayNameSchema } from "@orbita/shared";

/*
 * Lógica pura do perfil: validar o que o dono digita (as mesmas regras e mensagens do servidor) e montar o
 * cumprimento ("Boa tarde, Alisson"). O nome só enfeita a tela; nenhum número depende dele.
 */

export type ParsedName = { ok: true; value: string } | { ok: false; message: string };

/** "Nome" do dono: 1 a 40 letras, sem espaços nas pontas. */
export function parseDisplayName(input: string): ParsedName {
	const parsed = displayNameSchema.safeParse(input);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, message: parsed.error.issues[0]?.message ?? "Nome inválido." };
}

/** Nome do aparelho: 1 a 60 letras. */
export function parseDeviceName(input: string): ParsedName {
	const parsed = deviceNameSchema.safeParse(input);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, message: parsed.error.issues[0]?.message ?? "Nome inválido." };
}

/** A primeira palavra do nome ("Alisson Camargo" → "Alisson"); `null` sem nome. */
export function firstName(displayName: string | null | undefined): string | null {
	const word = displayName?.trim().split(/\s+/)[0];
	return word ? word : null;
}

/** "Boa tarde" + nome → "Boa tarde, Alisson"; sem nome, só o cumprimento. */
export function greetWithName(greeting: string, displayName: string | null | undefined): string {
	const name = firstName(displayName);
	return name ? `${greeting}, ${name}` : greeting;
}

/** Cumprimento do chat: "Olá, Alisson" ou "Olá". */
export const hello = (displayName: string | null | undefined): string => greetWithName("Olá", displayName);

/** Letra do avatar: a inicial do nome, em maiúscula; sem nome, a de sempre. */
export function avatarInitial(displayName: string | null | undefined, fallback = "V"): string {
	const first = [...(firstName(displayName) ?? "")][0];
	return first ? first.toLocaleUpperCase("pt-BR") : fallback;
}
