import { createPrivateKey, createVerify, type KeyObject, sign, X509Certificate } from "node:crypto";

/** Segredos colados em variável de ambiente às vezes perdem as quebras de linha reais (viram `\n` literal). */
export function normalizePem(raw: string): string {
	const text = raw.trim();
	return text.includes("\n") ? text : text.replace(/\\n/g, "\n");
}

export function loadPrivateKey(pem: string): KeyObject {
	const key = createPrivateKey(normalizePem(pem));
	if (key.asymmetricKeyType !== "rsa") {
		throw new Error("A chave de assinatura precisa ser RSA (o app só aceita rsa-v1_5-sha256).");
	}
	return key;
}

/** RSASSA-PKCS1-v1_5 com SHA-256, em base64 padrão: o que o expo-updates verifica. */
export function signManifest(manifestJson: string, privateKey: KeyObject): string {
	return sign("sha256", Buffer.from(manifestJson, "utf8"), privateKey).toString("base64");
}

export function verifyManifestSignature(
	manifestJson: string,
	signatureBase64: string,
	publicKey: KeyObject,
): boolean {
	return createVerify("sha256")
		.update(Buffer.from(manifestJson, "utf8"))
		.verify(publicKey, Buffer.from(signatureBase64, "base64"));
}

export type CertificateInfo = { publicKey: KeyObject; notBefore: Date; notAfter: Date };

/** O certificado que vai embutido no app (`apps/mobile/certs/ota-certificate.pem`). */
export function readCertificate(pem: string): CertificateInfo {
	const cert = new X509Certificate(normalizePem(pem));
	return {
		publicKey: cert.publicKey,
		notBefore: new Date(cert.validFrom),
		notAfter: new Date(cert.validTo),
	};
}
