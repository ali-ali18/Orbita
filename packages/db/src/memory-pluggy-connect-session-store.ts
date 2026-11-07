import type { PluggyConnectSessionStore } from "./pluggy-connect-session-store.ts";

type Row = { tokenHash: string; deviceId: string; createdAt: Date; expiresAt: Date; usedAt: Date | null };

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryPluggyConnectSessionStore(): PluggyConnectSessionStore {
	const rows: Row[] = [];
	const alive = (r: Row, now: Date) => r.usedAt === null && r.expiresAt > now;
	return {
		async create({ tokenHash, deviceId, expiresAt, now }) {
			for (const r of rows) if (alive(r, now)) r.expiresAt = now;
			rows.push({ tokenHash, deviceId, createdAt: now, expiresAt, usedAt: null });
		},
		async find(tokenHash, now) {
			const r = rows.find((x) => x.tokenHash === tokenHash);
			return r && alive(r, now) ? { deviceId: r.deviceId, createdAt: r.createdAt } : null;
		},
		async consume(tokenHash, now) {
			const r = rows.find((x) => x.tokenHash === tokenHash);
			if (!r || !alive(r, now)) return false;
			r.usedAt = now;
			return true;
		},
		async release(tokenHash) {
			const r = rows.find((x) => x.tokenHash === tokenHash);
			if (r) r.usedAt = null;
		},
		async deleteStale(before) {
			let n = 0;
			for (let i = rows.length - 1; i >= 0; i--) {
				const r = rows[i];
				if (r && ((r.usedAt && r.usedAt < before) || r.expiresAt < before)) {
					rows.splice(i, 1);
					n++;
				}
			}
			return n;
		},
	};
}
