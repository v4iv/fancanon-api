import { auth } from "@/lib/auth";

export type AppContext = {
  Bindings: CloudflareBindings;
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
};
