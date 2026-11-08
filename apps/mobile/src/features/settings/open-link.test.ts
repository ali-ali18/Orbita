import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn(async () => undefined) } }));

import { isRepoUrl } from "./open-link.ts";
import { BACKUP_DOCS_URL, REPO_URL } from "./report-model.ts";

describe("endereços do repositório", () => {
	it("só aceita o repositório do projeto", () => {
		expect(isRepoUrl(REPO_URL)).toBe(true);
		expect(isRepoUrl(`${REPO_URL}/issues/new?title=oi`)).toBe(true);
		expect(isRepoUrl(BACKUP_DOCS_URL)).toBe(true);
		expect(isRepoUrl("https://github.com/ali-ali18/Orbita-fake")).toBe(false);
		expect(isRepoUrl("https://github.com/outro/Orbita")).toBe(false);
		expect(isRepoUrl("javascript:alert(1)")).toBe(false);
		expect(isRepoUrl("https://github.com/ali-ali18/Orbita@evil.com")).toBe(false);
	});
});
