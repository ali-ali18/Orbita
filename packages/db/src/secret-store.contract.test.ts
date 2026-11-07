import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("SecretStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("guarda, lê e troca o texto cifrado sem duplicar", async () => {
		const first = await stores.secrets.put("anthropic_api_key", "v1.aaa", "Galaxy");
		expect(first).toMatchObject({ name: "anthropic_api_key", updatedBy: "Galaxy" });
		expect(await stores.secrets.get("anthropic_api_key")).toBe("v1.aaa");

		const second = await stores.secrets.put("anthropic_api_key", "v1.bbb", "Pixel");
		expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
		expect(second.updatedBy).toBe("Pixel");
		expect(await stores.secrets.get("anthropic_api_key")).toBe("v1.bbb");
		expect((await stores.secrets.list())[0]?.updatedBy).toBe("Pixel");
		expect(await stores.secrets.list()).toHaveLength(1);
	});

	it("get de quem não existe é null", async () => {
		expect(await stores.secrets.get("pluggy_client_id")).toBeNull();
	});

	it("lista só nome, data e quem gravou, ordenado pelo nome, sem o texto cifrado", async () => {
		await stores.secrets.put("pluggy_client_id", "v1.ccc", "Galaxy");
		await stores.secrets.put("anthropic_api_key", "v1.aaa", "Galaxy");
		const list = await stores.secrets.list();
		expect(list.map((s) => s.name)).toEqual(["anthropic_api_key", "pluggy_client_id"]);
		for (const item of list) {
			expect(Object.keys(item).sort()).toEqual(["name", "updatedAt", "updatedBy"]);
			expect(item.updatedAt).toBeInstanceOf(Date);
		}
	});

	it("remove e informa se existia", async () => {
		await stores.secrets.put("pluggy_client_secret", "v1.ddd", "Galaxy");
		expect(await stores.secrets.remove("pluggy_client_secret")).toBe(true);
		expect(await stores.secrets.remove("pluggy_client_secret")).toBe(false);
		expect(await stores.secrets.get("pluggy_client_secret")).toBeNull();
		expect(await stores.secrets.list()).toEqual([]);
	});
});
