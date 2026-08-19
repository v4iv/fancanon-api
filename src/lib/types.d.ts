import { auth } from '@/lib/auth'
import type { Database } from '@/lib/db'

export type AppContext = {
  Bindings: CloudflareBindings
  Variables: {
    db: Database
    user: typeof auth.$Infer.Session.user | null
    session: typeof auth.$Infer.Session.session | null
  }
}
