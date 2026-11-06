import { z } from "zod";

/** Código de pareamento: 6 dígitos, gerado no servidor e digitado no app. */
export const PAIRING_CODE_LENGTH = 6;

export const pairingClaimBody = z.object({
	code: z
		.string()
		.trim()
		.regex(new RegExp(`^\\d{${PAIRING_CODE_LENGTH}}$`), "O código tem 6 números."),
	deviceName: z.string().trim().min(1).max(60),
});
export type PairingClaimBody = z.infer<typeof pairingClaimBody>;

/** Resposta de `POST /v1/pairing/codes`: um aparelho já pareado convida outro. */
export const pairingCodeResponse = z.object({
	code: z.string(),
	expiresAt: z.string(),
});
export type PairingCodeResponse = z.infer<typeof pairingCodeResponse>;

export const deviceSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
});
export type DeviceDto = z.infer<typeof deviceSchema>;

export const pairingClaimResponse = z.object({
	token: z.string(),
	device: deviceSchema,
});
export type PairingClaimResponse = z.infer<typeof pairingClaimResponse>;

/** Corpo padrão de erro da API: mensagem pronta para mostrar ao usuário. */
export const apiErrorSchema = z.object({
	error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
