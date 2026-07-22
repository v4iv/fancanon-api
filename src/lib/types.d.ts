import { PrismaClient } from "@/generated/prisma/client";

export type AppContext = {
  Bindings: {
    DATABASE_URL: string;
    DIRECT_URL: string;
  };
  Variables: {
    db: PrismaClient;
  };
};
