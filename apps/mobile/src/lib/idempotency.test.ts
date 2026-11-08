import { describe, expect, it } from "vitest";
import { createSubmissionKey, newIdempotencyKey } from "./idempotency.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newIdempotencyKey", () => {
	it("gera UUID v4 e muda a cada chamada", () => {
		const a = newIdempotencyKey();
		expect(a).toMatch(UUID_V4);
		expect(newIdempotencyKey()).not.toBe(a);
	});

	it("marca versão e variante mesmo com bytes extremos", () => {
		expect(newIdempotencyKey(() => new Uint8Array(16).fill(0xff))).toBe(
			"ffffffff-ffff-4fff-bfff-ffffffffffff",
		);
		expect(newIdempotencyKey(() => new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
	});
});

describe("createSubmissionKey", () => {
	it("mantém a chave entre tentativas e troca depois de renew", () => {
		let n = 0;
		const submission = createSubmissionKey(() => `k${++n}`);
		expect(submission.current()).toBe("k1");
		expect(submission.current()).toBe("k1");
		submission.renew();
		expect(submission.current()).toBe("k2");
		expect(submission.current()).toBe("k2");
	});
});
