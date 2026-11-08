import { Platform } from "react-native";

export type SaveOutcome = "shared" | "downloaded" | "unavailable";

/**
 * Entrega o arquivo exportado ao dono.
 * - Web: baixa pelo navegador.
 * - Celular: grava no cache privado do app e abre a folha de compartilhar (`expo-sharing`), para ele mandar para o
 *   Drive, e-mail ou arquivos. O cache é só do app; os `orbita-*` de exportações anteriores são apagados antes de
 *   criar o novo, para não acumular dados financeiros por lá. Os módulos nativos entram só aqui (APK novo).
 */
export async function saveExport(file: {
	filename: string;
	mime: string;
	text: string;
}): Promise<SaveOutcome> {
	if (Platform.OS === "web") {
		if (typeof document === "undefined") return "unavailable";
		const url = URL.createObjectURL(new Blob([file.text], { type: `${file.mime};charset=utf-8` }));
		const link = document.createElement("a");
		link.href = url;
		link.download = file.filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
		return "downloaded";
	}
	const [{ Directory, File, Paths }, Sharing] = await Promise.all([
		import("expo-file-system"),
		import("expo-sharing"),
	]);
	if (!(await Sharing.isAvailableAsync())) return "unavailable";
	for (const entry of new Directory(Paths.cache).list()) {
		if (entry instanceof File && entry.name.startsWith("orbita-")) {
			try {
				entry.delete();
			} catch {}
		}
	}
	const target = new File(Paths.cache, file.filename);
	target.create({ overwrite: true });
	target.write(file.text);
	await Sharing.shareAsync(target.uri, { mimeType: file.mime, dialogTitle: "Exportar do Órbita" });
	return "shared";
}
