import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";

export type Db = InstanceType<typeof PrismaClient>;

export function createDb(connectionString: string): Db {
	return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
