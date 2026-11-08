/**
 * Monta um PDF mínimo (Helvetica, uma coluna de linhas por página) só para os testes: os fixtures são sintéticos
 * e não há dado pessoal. Cada linha é `{ x, text }[]` (colunas) ou uma string. Não é usado em produção.
 */
export type PdfLine = string | ReadonlyArray<{ x: number; text: string }>;

const escapePdf = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(
	pages: ReadonlyArray<readonly PdfLine[]>,
	options: { encrypt?: boolean } = {},
): Uint8Array {
	const objects: string[] = [];
	const add = (body: string) => {
		objects.push(body);
		return objects.length;
	};
	const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
	const pagesId = add("PLACEHOLDER");
	const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	const kids: number[] = [];
	for (const lines of pages) {
		const ops: string[] = ["BT", "/F1 10 Tf"];
		let y = 780;
		for (const line of lines) {
			const cols = typeof line === "string" ? [{ x: 40, text: line }] : line;
			for (const col of cols) ops.push(`1 0 0 1 ${col.x} ${y} Tm (${escapePdf(col.text)}) Tj`);
			y -= 14;
		}
		ops.push("ET");
		const stream = ops.join("\n");
		const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
		kids.push(
			add(
				`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
			),
		);
	}
	objects[pagesId - 1] =
		`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${options.encrypt ? " /Encrypt << /Filter /Standard >>" : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}
