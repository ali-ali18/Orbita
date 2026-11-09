/* Suporte de teste (sem rede) para quem precisa de um Pluggy de mentira: usado pelos testes de ponta a ponta do ledger. */
export { CLIENT_ID, CLIENT_SECRET, fakePluggy } from "./pluggy/fake-pluggy.ts";
export { ACCOUNTS, ITEMS, REAL_NOW, realPluggyOptions } from "./pluggy/real-data.fixture.ts";
