"use client";

// Bridges auth state into factState's Supabase sync. Mounted once in the
// root layout (renders nothing) so progress sync works on every route, not
// just the home screen where AuthChip lives.

import { useEffect } from "react";
import { useSession } from "@/lib/auth";
import { syncSessionUser } from "@/lib/factState";

export default function FactStateSync() {
  const session = useSession();

  useEffect(() => {
    syncSessionUser(session === undefined ? undefined : session?.user.id ?? null);
  }, [session]);

  return null;
}
