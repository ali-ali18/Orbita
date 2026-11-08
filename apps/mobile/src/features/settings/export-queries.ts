import type { ExportFormat } from "@orbita/shared";
import { useMutation } from "@tanstack/react-query";
import { ApiError, call, UNREACHABLE_MESSAGE } from "../../lib/api.ts";
import { useSession } from "../../lib/session.tsx";
import { type SaveOutcome, saveExport } from "./export-file.ts";
import { EXPORT_MIME, filenameFrom } from "./export-model.ts";

/** Pede o arquivo ao servidor (autenticado) e entrega ao dono. O texto passa só pela memória deste pedido. */
export function useExportData() {
	const { api } = useSession();
	return useMutation({
		mutationFn: async (input: {
			format: ExportFormat;
			params: Record<string, string>;
			fallbackName: string;
		}): Promise<SaveOutcome> => {
			if (!api) throw new Error("Exportação sem sessão");
			const query = { ...input.params, format: input.format };
			let res: Awaited<ReturnType<typeof api.v1.export.$get>>;
			try {
				res = await api.v1.export.$get({ query });
			} catch {
				throw new ApiError(UNREACHABLE_MESSAGE, null, "sem_conexao");
			}
			// Falha (429 do limite, 400…) vem como JSON de erro: `call` monta o `ApiError` em pt-BR.
			if (!res.ok) await call(async () => res);
			const text = await res.text();
			return saveExport({
				filename: filenameFrom(res.headers.get("content-disposition"), input.fallbackName),
				mime: EXPORT_MIME[input.format],
				text,
			});
		},
	});
}
