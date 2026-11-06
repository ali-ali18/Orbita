import { createDb, createPrismaAuthStore } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { loadEnv } from "../env.ts";
import { createPairingCode } from "../modules/pairing/service.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
try {
	const { code, expiresAt } = await createPairingCode({
		store: createPrismaAuthStore(db),
		pairingKey: deriveKey(env.APP_SECRET, "pairing-code"),
		now: () => new Date(),
	});
	const hora = expiresAt.toLocaleTimeString("pt-BR", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "America/Sao_Paulo",
	});
	console.log(`\n  Código de pareamento: ${code.slice(0, 3)} ${code.slice(3)}\n`);
	console.log(`  Vale até ${hora} (10 minutos) e só uma vez.`);
	console.log(`  No app, toque em "Conectar" e digite o código.\n`);
} finally {
	await db.$disconnect();
}
