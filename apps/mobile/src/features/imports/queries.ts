import type { CsvMappingBody, ImportPreviewResponse, ImportResponse } from "@orbita/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DocumentPickerAsset } from "expo-document-picker";
import { Platform } from "react-native";
import { call } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { isAffectedByNewTransaction } from "../transactions/new-transaction-model.ts";
import { type ImportTarget, targetFields } from "./import-model.ts";
import { sendRetryingOnce } from "./send-retry.ts";

export interface ImportRequest {
	file: DocumentPickerAsset;
	target: ImportTarget;
	mapping?: CsvMappingBody | null;
	invertSign?: boolean;
	includePossibleDuplicates?: boolean;
}

/**
 * Monta o formulário multipart. Na web o seletor devolve o `File` pronto; no celular o React Native lê o arquivo
 * pelo `uri` quando o corpo é enviado (nada é carregado na memória do JavaScript).
 */
function buildForm(request: ImportRequest): FormData {
	const form = new FormData();
	const { file } = request;
	if (Platform.OS === "web" && file.file) {
		form.append("file", file.file, file.name);
	} else {
		// O tipo de FormData do React Native aceita { uri, name, type }.
		form.append("file", {
			uri: file.uri,
			name: file.name,
			type: file.mimeType ?? "application/octet-stream",
		} as unknown as Blob);
	}
	for (const [key, value] of Object.entries(targetFields(request.target))) form.append(key, value);
	if (request.mapping) form.append("mapping", JSON.stringify(request.mapping));
	if (request.invertSign) form.append("invertSign", "true");
	if (request.includePossibleDuplicates) form.append("includePossibleDuplicates", "true");
	return form;
}

function useSender() {
	const { state } = useSession();
	if (state.status !== "in") throw new Error("Importação sem sessão");
	return <T>(path: string, request: ImportRequest): Promise<T> =>
		call(() =>
			// Cada tentativa monta o formulário de novo: o corpo com arquivo só pode ser enviado uma vez.
			sendRetryingOnce(() =>
				fetch(`${state.baseUrl}${path}`, {
					method: "POST",
					// Sem Content-Type: o fetch coloca o `multipart/form-data` com o limite certo.
					headers: { Authorization: `Bearer ${state.token}` },
					body: buildForm(request),
				}),
			),
		) as Promise<T>;
}

/** Lê o arquivo no servidor e devolve o que aconteceria, sem gravar nada. */
export function usePreviewImport() {
	const send = useSender();
	return useMutation({
		mutationFn: (request: ImportRequest) => send<ImportPreviewResponse>("/v1/imports/preview", request),
	});
}

/** Grava como pendente. Os pendentes, o Início e as Atividades recarregam. */
export function useRunImport() {
	const send = useSender();
	const { baseUrl } = useSession();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (request: ImportRequest) => send<ImportResponse>("/v1/imports", request),
		onSuccess: () => {
			if (!baseUrl) return;
			void queryClient.invalidateQueries({
				predicate: (query) => isAffectedByNewTransaction(query.queryKey, baseUrl),
			});
		},
	});
}
