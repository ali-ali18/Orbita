import { assertCents } from "./money.ts";
import type { Cents } from "./types.ts";

/**
 * Reduz limites (por id) para que a soma não passe de `targetCents`, proporcionalmente e só com inteiros.
 *
 * - `locked[id]` é a parte do limite que nunca encolhe (assinaturas, parcelas): só o restante é reduzido.
 * - O resto dos centavos vai, um a um, para quem tem a maior fração perdida; empate pelo id (determinístico).
 * - Se já cabe, devolve os mesmos valores. Se nem o travado cabe, devolve o travado (o chamador avisa).
 * - Quando reduz, a soma é exatamente `targetCents`.
 */
export function scaleDownToFit(
	values: Readonly<Record<string, Cents>>,
	targetCents: Cents,
	locked: Readonly<Record<string, Cents>> = {},
): Record<string, Cents> {
	assertCents(targetCents, "targetCents");
	if (targetCents < 0) throw new RangeError("o teto não pode ser negativo");
	const ids = Object.keys(values).sort();
	let total = 0;
	let lockedSum = 0;
	const fixed = new Map<string, Cents>();
	const flex = new Map<string, Cents>();
	for (const id of ids) {
		const v = values[id] as Cents;
		assertCents(v, `limite de ${id}`);
		if (v < 0) throw new RangeError(`limite de ${id}: não pode ser negativo`);
		const keep = Math.min(v, Math.max(0, locked[id] ?? 0));
		fixed.set(id, keep);
		flex.set(id, v - keep);
		total += v;
		lockedSum += keep;
	}
	if (total <= targetCents) return { ...values };

	const room = BigInt(Math.max(0, targetCents - lockedSum));
	const flexSum = BigInt(ids.reduce((s, id) => s + (flex.get(id) as Cents), 0));
	if (flexSum === 0n) return Object.fromEntries(ids.map((id) => [id, fixed.get(id) as Cents]));

	const shares = ids.map((id) => {
		const product = BigInt(flex.get(id) as Cents) * room;
		return { id, base: product / flexSum, rest: product % flexSum };
	});
	let leftover = Number(room - shares.reduce((s, x) => s + x.base, 0n));
	const order = [...shares].sort((a, b) =>
		a.rest === b.rest ? (a.id < b.id ? -1 : 1) : a.rest > b.rest ? -1 : 1,
	);
	const extra = new Map<string, number>();
	for (const s of order) {
		if (leftover <= 0) break;
		if (s.rest === 0n) continue;
		extra.set(s.id, 1);
		leftover -= 1;
	}
	return Object.fromEntries(
		shares.map((s) => [s.id, (fixed.get(s.id) as Cents) + Number(s.base) + (extra.get(s.id) ?? 0)]),
	);
}
