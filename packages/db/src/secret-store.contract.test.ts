import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("SecretStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("guarda, lê e troca o texto cifrado sem duplicar", async () => {
		const first = await stores.secrets.put("anthropic_api_key", "v1.aaa");
		expect(first.name).toBe("anthropic_api_key");
		expect(await stores.secrets.get("anthropic_api_key")).toBe("v1.aaa");

		const second = await stores.secrets.put("anthropic_api_key", "v1.bbb");
		expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
		expect(await stores.secrets.get("anthropic_api_key")).toBe("v1.bbb");
		expect(await stores.secrets.list()).toHaveLength(1);
	});

	it("get de quem não existe é null", async () => {
		expect(await stores.secrets.get("pluggy_client_id")).toBeNull();
	});

	it("lista só nome e data, ordenado pelo nome, sem o texto cifrado", async () => {
		await stores.secrets.put("pluggy_client_id", "v1.ccc");
		await stores.secrets.put("anthropic_api_key", "v1.aaa");
		const list = await stores.secrets.list();
		expect(list.map((s) => s.name)).toEqual(["anthropic_api_key", "pluggy_client_id"]);
		for (const item of list) {
			expect(Object.keys(item).sort()).toEqual(["name", "updatedAt"]);
			expect(item.updatedAt).toBeInstanceOf(Date);
		}
	});

	it("remove e informa se existia", async () => {
		await stores.secrets.put("pluggy_client_secret", "v1.ddd");
		expect(await stores.secrets.remove("pluggy_client_secret")).toBe(true);
		expect(await stores.secrets.remove("pluggy_client_secret")).toBe(false);
		expect(await stores.secrets.get("pluggy_client_secret")).toBeNull();
		expect(await stores.secrets.list()).toEqual([]);
	});
});
