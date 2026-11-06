import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "./generated/prisma/client.ts";

export type Db = InstanceType<typeof PrismaClient>;
/** O client normal ou o de dentro de `$transaction`. */
export type DbClient = Db | Prisma.TransactionClient;

export function createDb(connectionString: string): Db {
	return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
