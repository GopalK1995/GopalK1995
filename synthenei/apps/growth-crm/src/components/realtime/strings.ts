// Component strings: English defaults plus a Tamil draft (flagged for review). Pass `labels` to override from a messages namespace.
export interface RealtimeStrings {
  syncLive: string; syncReconnecting: string; syncOffline: string; syncSample: string; syncTitle: string;
  hereNone: string; hereOne: string; hereMany: string; sampleTag: string;
  editing: string; editingMany: string;
  pending: string; pendingOne: string; refresh: string;
  conflictTitle: string; conflictTitleUnknown: string; conflictBody: string;
  colField: string; colTheirs: string; colMine: string; keepMine: string; takeTheirs: string; autoTheirs: string; autoMine: string;
  merge: string; discard: string; empty: string;
}
export const EN: RealtimeStrings = {
  syncLive: "Live", syncReconnecting: "Reconnecting", syncOffline: "Offline", syncSample: "Sample presence",
  syncTitle: "Live updates connection",
  hereNone: "No one else is here", hereOne: "{name} is here", hereMany: "{n} others are here: {names}", sampleTag: "sample colleague",
  editing: "{name} is editing {field}", editingMany: "{n} people are editing",
  pending: "{n} changes, refresh", pendingOne: "1 change, refresh", refresh: "Refresh",
  conflictTitle: "Changed by {name} {ago}: review", conflictTitleUnknown: "Changed by a colleague {ago}: review",
  conflictBody: "Your edits are not saved yet. Pick what to keep for each field.",
  colField: "Field", colTheirs: "Their change", colMine: "Your change", keepMine: "Keep mine", takeTheirs: "Use theirs",
  autoTheirs: "Only they changed this; it is applied", autoMine: "Only you changed this; it is kept",
  merge: "Merge and continue", discard: "Discard my changes", empty: "(empty)",
};
/** Machine draft, needs native review before it ships. */
export const TA_DRAFT: RealtimeStrings = {
  ...EN,
  syncLive: "நேரலை", syncReconnecting: "மீண்டும் இணைகிறது", syncOffline: "இணைப்பு இல்லை", syncSample: "மாதிரி இருப்பு",
  pending: "{n} மாற்றங்கள், புதுப்பிக்கவும்", pendingOne: "1 மாற்றம், புதுப்பிக்கவும்", refresh: "புதுப்பிக்கவும்",
  merge: "இணைத்து தொடரவும்", discard: "என் மாற்றங்களை நீக்கு", keepMine: "என்னுடையது", takeTheirs: "அவர்களுடையது",
};
export function fill(t: string, v: Record<string, string | number>): string { return t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? "")); }
