import { auth } from "@/lib/auth";
import { PrismaClient } from "@/generated/prisma/client";

export type AppContext = {
  Bindings: CloudflareBindings;
  Variables: {
    db: PrismaClient;
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
};
