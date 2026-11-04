// Icon allow-list for custom objects: the stored value is a name from this list (object_types.icon), never arbitrary markup.
import { Box, BriefcaseBusiness, Building, CalendarDays, Car, ClipboardList, FileText, FlaskConical, House, Layers, MapPin, Package, Receipt, Ticket, Truck, Users, Wrench, type LucideIcon } from "lucide-react";

export const OBJECT_ICONS: Record<string, LucideIcon> = {
  box: Box, briefcase: BriefcaseBusiness, building: Building, calendar: CalendarDays, car: Car, clipboard: ClipboardList, file: FileText,
  flask: FlaskConical, home: House, layers: Layers, pin: MapPin, package: Package, receipt: Receipt, ticket: Ticket, truck: Truck, users: Users, wrench: Wrench,
};
export const ICON_KEYS = Object.keys(OBJECT_ICONS);
export const DEFAULT_ICON = "box";
export const iconFor = (name: string | null | undefined): LucideIcon => OBJECT_ICONS[name ?? ""] ?? Box;
export const safeIcon = (name: string | null | undefined): string => (name && name in OBJECT_ICONS ? name : DEFAULT_ICON);
