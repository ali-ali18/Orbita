import { Platform } from "react-native";
import {
	type AttachKind,
	bytesToBase64,
	checkAttachment,
	checkPickedPdf,
	IMAGE_MAX_SIDE,
	IMAGE_QUALITY,
	PERMISSION_CAMERA_MESSAGE,
	type PickOutcome,
	READ_FAILED_MESSAGE,
} from "./attachment-model.ts";

/*
 * Escolher a foto (câmera ou galeria) ou o PDF e deixar tudo pronto para o envio: a foto é reduzida e regravada
 * como JPEG (um comprovante de câmera moderna passa de 5 MB; reduzida fica em poucas centenas de KB) e o PDF é
 * lido como veio. Os módulos nativos entram só aqui, na hora do uso (APK novo: expo-image-picker e
 * expo-image-manipulator). Nada é gravado: o arquivo vive na memória até o envio.
 */

export async function pickAttachment(kind: AttachKind): Promise<PickOutcome> {
	try {
		return kind === "pdf" ? await pickPdf() : await pickPhoto(kind);
	} catch {
		return { status: "error", message: READ_FAILED_MESSAGE };
	}
}

async function pickPhoto(kind: "camera" | "library"): Promise<PickOutcome> {
	const [Picker, { ImageManipulator, SaveFormat }] = await Promise.all([
		import("expo-image-picker"),
		import("expo-image-manipulator"),
	]);
	const options = { mediaTypes: ["images" as const], quality: 1, allowsMultipleSelection: false };
	let result: Awaited<ReturnType<typeof Picker.launchCameraAsync>>;
	if (kind === "camera") {
		const permission = await Picker.requestCameraPermissionsAsync();
		if (!permission.granted) return { status: "error", message: PERMISSION_CAMERA_MESSAGE };
		result = await Picker.launchCameraAsync(options);
	} else {
		// A galeria do Android 13+ usa o seletor do sistema e não pede permissão; nas versões antigas e na web, pede.
		result = await Picker.launchImageLibraryAsync(options);
	}
	if (result.canceled) return { status: "cancelled" };
	const asset = result.assets[0];
	if (!asset) return { status: "cancelled" };

	const context = ImageManipulator.manipulate(asset.uri, {
		maxWidth: IMAGE_MAX_SIDE,
		maxHeight: IMAGE_MAX_SIDE,
	});
	const image = await context.renderAsync();
	const saved = await image.saveAsync({ base64: true, compress: IMAGE_QUALITY, format: SaveFormat.JPEG });
	if (!saved.base64) return { status: "error", message: READ_FAILED_MESSAGE };
	const attachment = { mediaType: "image/jpeg" as const, data: saved.base64 };
	const problem = checkAttachment(attachment);
	if (problem) return { status: "error", message: problem };
	return { status: "ok", attachment: { ...attachment, name: asset.fileName ?? "foto.jpg" } };
}

async function pickPdf(): Promise<PickOutcome> {
	const { getDocumentAsync } = await import("expo-document-picker");
	const picked = await getDocumentAsync({
		type: "application/pdf",
		copyToCacheDirectory: true,
		multiple: false,
	});
	if (picked.canceled) return { status: "cancelled" };
	const asset = picked.assets[0];
	if (!asset) return { status: "cancelled" };
	// Confere tipo e tamanho antes de ler o arquivo inteiro para a memória.
	const early = checkPickedPdf({ mimeType: asset.mimeType, name: asset.name, size: asset.size });
	if (early) return { status: "error", message: early };

	const buffer = await readBuffer(asset);
	if (buffer.byteLength === 0) return { status: "error", message: READ_FAILED_MESSAGE };
	const attachment = { mediaType: "application/pdf" as const, data: bytesToBase64(new Uint8Array(buffer)) };
	const problem = checkAttachment(attachment);
	if (problem) return { status: "error", message: problem };
	return { status: "ok", attachment: { ...attachment, name: asset.name } };
}

async function readBuffer(asset: { uri: string; file?: File | undefined }): Promise<ArrayBuffer> {
	if (Platform.OS === "web" && asset.file) return asset.file.arrayBuffer();
	const { File } = await import("expo-file-system");
	return new File(asset.uri).arrayBuffer();
}
