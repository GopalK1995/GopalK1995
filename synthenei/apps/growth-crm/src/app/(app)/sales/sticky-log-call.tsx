"use client";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogCallDialog } from "@/components/quick-actions";
import { useSession } from "@/components/shell/providers";
import { can } from "@/lib/auth/roles";

/** Phone only: a persistent, thumb-reachable Log call (44px tall) docked just above the 56px bottom nav. Hidden from lg up, where Quick log is in the page. */
export function StickyLogCall() {
  const { role, support } = useSession();
  if (!can("workLeads", { role, support })) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-2 shadow-pop backdrop-blur lg:hidden">
      <LogCallDialog trigger={<Button variant="primary" className="h-11 w-full text-[14px]"><Phone />Log call</Button>} />
    </div>
  );
}
