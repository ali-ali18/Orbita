import { MAX_CENTS } from "@orbita/shared";

function groupedThousands(text: string, sep: string): boolean {
	const [first = "", ...rest] = text.split(sep);
	return /^\d{1,3}$/.test(first) && rest.every((g) => /^\d{3}$/.test(g));
}

/**
 * Valor em texto → centavos, só com aritmética de texto (nunca `float`). Aceita:
 * "1.234,56", "1234,56", "1,234.56", "-12.30", "+12,5", "R$ 1.234,56", "(12,30)" e "12,30-" (negativos), "12".
 * Devolve `null` quando o texto não é um valor ou é ambíguo: "1.234" e "1,234" (milhar ou decimal?) não se
 * adivinham; "12,345" (3 casas) também não.
 */
export function parseAmount(raw: string): number | null {
	let text = raw.replace(/\s+/g, "").replace(/R\$/gi, "");
	if (text === "") return null;
	let negative = false;
	if (/^\(.*\)$/.test(text)) {
		negative = true;
		text = text.slice(1, -1);
	}
	const lead = /^([-+−–])/.exec(text);
	if (lead) {
		negative = negative !== (lead[1] !== "+");
		text = text.slice(1);
	}
	if (text.endsWith("-")) {
		negative = !negative;
		text = text.slice(0, -1);
	}
	if (!/^[\d.,]+$/.test(text) || !/^\d/.test(text) || !/\d$/.test(text)) return null;

	const lastDot = text.lastIndexOf(".");
	const lastComma = text.lastIndexOf(",");
	let whole: string;
	let fraction = "";
	if (lastDot >= 0 && lastComma >= 0) {
		// Os dois: o último é o decimal; o outro só pode ser milhar.
		const decimalAt = Math.max(lastDot, lastComma);
		const decimalSep = text.charAt(decimalAt);
		const thousands = decimalSep === "." ? "," : ".";
		const head = text.slice(0, decimalAt);
		if (head.includes(decimalSep) || !groupedThousands(head, thousands)) return null;
		whole = head.split(thousands).join("");
		fraction = text.slice(decimalAt + 1);
	} else if (lastDot >= 0 || lastComma >= 0) {
		const sep = lastDot >= 0 ? "." : ",";
		const parts = text.split(sep);
		if (parts.length > 2) {
			// "1.234.567": só pode ser milhar.
			if (!groupedThousands(text, sep)) return null;
			whole = parts.join("");
		} else {
			const [head = "", tail = ""] = parts;
			if (tail.length === 0 || tail.length === 3) return null;
			whole = head;
			fraction = tail;
		}
	} else {
		whole = text;
	}
	if (!/^\d+$/.test(whole) || (fraction !== "" && !/^\d+$/.test(fraction))) return null;
	if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) return null;
	if (whole.length > 11) return null;
	const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
	if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
	return negative && cents !== 0 ? -cents : cents;
}
