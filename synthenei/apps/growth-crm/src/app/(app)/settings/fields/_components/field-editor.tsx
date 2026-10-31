"use client";
// Create / edit dialog for one field definition. The form holds a plain draft; the server action validates it with the
// same schema (src/lib/metadata/defs.ts) and returns issues by path, which are shown under the matching control.
import { useMemo, useState, useTransition } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { FieldInput } from "@/components/fields/field-input";
import { fieldFromInput, fieldInputSchema, inputFromField, keyFromLabel, type FieldInput as Draft } from "@/lib/metadata/defs";
import { toClientField } from "@/lib/metadata/runtime";
import { tIn } from "@/lib/metadata/strings";
import { EDITOR_TYPES, FIELD_COLORS, type FieldDef, type FieldType } from "@/lib/metadata/types";
import { createField, updateField } from "../actions";

type Choice = NonNullable<Draft["choices"]>[number];
const NUMERIC: FieldType[] = ["number", "money", "percent"];
const TEXTY: FieldType[] = ["text", "long_text", "email", "phone", "url"];

export interface EditorProps {
  open: boolean; onOpenChange: (o: boolean) => void; strings: Record<string, string>;
  objectKey: string; objects: { key: string; one: string; many: string }[]; roles: { value: string; label: string }[];
  /** Present when editing. */
  field: FieldDef | null; onSaved: () => void;
}

const blank = (objectKey: string): Draft => ({
  objectKey, key: "", label: { en: "", ta: "" }, type: "text", section: "", required: false, uniqueInWorkspace: false, isPii: false,
  isSearchable: false, isFilterable: true, choices: [], help: { en: "", ta: "" }, validation: {}, viewRoles: [], editRoles: [], editablePerm: null,
});

export function FieldEditor(p: EditorProps) {
  const t = tIn(p.strings);
  const editing = p.field;
  const [draft, setDraft] = useState<Draft>(() => (editing ? inputFromField(p.objectKey, editing) : blank(p.objectKey)));
  const [keyTouched, setKeyTouched] = useState(!!editing);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [needReason, setNeedReason] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const type = draft.type;
  const types = useMemo(() => (EDITOR_TYPES.includes(type) ? EDITOR_TYPES : [...EDITOR_TYPES, type]), [type]);
  const choices = draft.choices ?? [];
  const setChoice = (i: number, c: Partial<Choice>) => set("choices", choices.map((x, n) => (n === i ? { ...x, ...c } : x)));
  const addChoice = () => set("choices", [...choices, { key: "", label: { en: "", ta: "" }, color: "neutral" }]);
  const original = new Set((editing?.options.choices ?? []).map((c) => c.key));
  const toggleRole = (k: "viewRoles" | "editRoles", role: string, on: boolean) => {
    const cur = new Set(draft[k] ?? []);
    if (on) cur.add(role); else cur.delete(role);
    set(k, [...cur]);
  };

  // The default value reuses the runtime input so it is entered exactly the way a record will enter it.
  const defaultDef = useMemo(() => {
    const parsed = fieldInputSchema.safeParse({ ...draft, key: draft.key || "preview", label: { en: draft.label.en || "x" }, choices: (draft.choices ?? []).map((c, i) => ({ ...c, key: c.key || `o${i}`, label: { en: c.label.en || "x" } })), lookupObject: draft.lookupObject || "lead", default: undefined });
    const base = parsed.success ? fieldFromInput(parsed.data) : null;
    return base ? toClientField({ ...base, id: "d", objectTypeId: "d", position: 0, archivedAt: null }, true) : null;
  }, [draft]);

  const submit = () => {
    const body: Draft = {
      ...draft,
      choices: choices.map((c, i) => ({ ...c, key: c.key || uniqueKey(c.label.en, choices.slice(0, i).map((x) => x.key), i) })),
    };
    start(async () => {
      const res = editing
        ? await updateField({ input: body, rev: editing.rev ?? "", reason: reason || undefined })
        : await createField(body);
      if (res.ok) { toast(res.message, res.sub); p.onSaved(); p.onOpenChange(false); return; }
      const map: Record<string, string> = {};
      for (const i of res.issues ?? []) map[i.path.split(".")[0]] = i.message;
      setIssues(map);
      if (map.reason) setNeedReason(true);
      setBanner(res.code === "conflict" ? `${res.message} ${res.sub ?? ""}` : map.reason ? null : res.message);
    });
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent title={editing ? t("editTitle", { label: editing.label.en }) : t("addTitle")} description={t("editorSub")} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {banner && <p role="alert" className="state-danger rounded-control border px-3 py-2 text-13">{banner}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("labelEn")} required error={issues.label}>
              <Input value={draft.label.en} onChange={(e) => { set("label", { ...draft.label, en: e.target.value }); if (!keyTouched) set("key", keyFromLabel(e.target.value)); }} />
            </Field>
            <Field label={t("labelTa")} help={t("labelTaHelp")}>
              <Input lang="ta" value={draft.label.ta ?? ""} onChange={(e) => set("label", { ...draft.label, ta: e.target.value })} />
            </Field>
            <Field label={t("keyLabel")} help={editing ? t("keyLocked") : t("keyHelp")} error={issues.key} required>
              <Input className="num-mono" value={draft.key} disabled={!!editing} onChange={(e) => { setKeyTouched(true); set("key", e.target.value); }} />
            </Field>
            <Field label={t("typeLabel")} error={issues.type} help={editing ? t("typeHelpEditing") : undefined}>
              {(c) => <Select id={c.id} aria-describedby={c["aria-describedby"]} value={type} onValueChange={(v) => set("type", v as FieldType)} options={types.map((x) => ({ value: x, label: t(`type_${x}`) }))} />}
            </Field>
            <Field label={t("sectionLabel")} help={t("sectionHelp")}>
              <Input value={draft.section ?? ""} onChange={(e) => set("section", e.target.value)} />
            </Field>
            <Field label={t("helpLabel")} help={t("helpHelp")}>
              <Input value={draft.help?.en ?? ""} onChange={(e) => set("help", { ...draft.help, en: e.target.value })} />
            </Field>
          </div>

          {(type === "select" || type === "multi_select") && (
            <fieldset className="grid gap-2" aria-describedby={issues.choices ? "choices-err" : undefined}>
              <legend className="label-caps mb-1">{t("optionsTitle")}</legend>
              {choices.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_8rem_auto] items-end gap-2">
                  <Field label={i === 0 ? t("optionLabelEn") : <span className="sr-only">{t("optionLabelEn")}</span>}>
                    <Input value={c.label.en} disabled={!!c.archived} onChange={(e) => setChoice(i, { label: { ...c.label, en: e.target.value } })} />
                  </Field>
                  <Field label={i === 0 ? t("optionLabelTa") : <span className="sr-only">{t("optionLabelTa")}</span>}>
                    <Input lang="ta" value={c.label.ta ?? ""} disabled={!!c.archived} onChange={(e) => setChoice(i, { label: { ...c.label, ta: e.target.value } })} />
                  </Field>
                  <Field label={i === 0 ? t("optionColor") : <span className="sr-only">{t("optionColor")}</span>}>
                    {(cc) => <Select id={cc.id} value={c.color ?? "neutral"} onValueChange={(v) => setChoice(i, { color: v })} options={FIELD_COLORS.map((x) => ({ value: x, label: t(`color_${x}`) }))} />}
                  </Field>
                  {original.has(c.key) ? (
                    <Button type="button" size="icon" variant="ghost" aria-label={c.archived ? t("restoreOption") : t("retireOption")} onClick={() => setChoice(i, { archived: !c.archived })}>
                      {c.archived ? <RotateCcw aria-hidden /> : <Trash2 aria-hidden />}
                    </Button>
                  ) : (
                    <Button type="button" size="icon" variant="ghost" aria-label={t("removeOption")} onClick={() => set("choices", choices.filter((_, n) => n !== i))}><Trash2 aria-hidden /></Button>
                  )}
                </div>
              ))}
              {choices.some((c) => c.archived) && <p className="text-12 text-ink-3">{t("retiredOptionsNote")}</p>}
              <div><Button type="button" size="sm" variant="quiet" onClick={addChoice}><Plus aria-hidden />{t("addOption")}</Button></div>
              {issues.choices && <p id="choices-err" role="alert" className="text-12 text-danger">{issues.choices}</p>}
            </fieldset>
          )}

          {type === "lookup" && (
            <Field label={t("lookupTarget")} error={issues.lookupObject}>
              {(c) => <Select id={c.id} value={draft.lookupObject} placeholder={t("choose")} onValueChange={(v) => set("lookupObject", v)} options={p.objects.map((o) => ({ value: o.key, label: o.one }))} />}
            </Field>
          )}

          {(NUMERIC.includes(type) || TEXTY.includes(type)) && (
            <div className="grid gap-3 sm:grid-cols-3">
              {NUMERIC.includes(type) && <>
                <Field label={t("minLabel")}><Input inputMode="decimal" className="num-mono" value={draft.validation?.min ?? ""} onChange={(e) => set("validation", { ...draft.validation, min: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
                <Field label={t("maxLabel")}><Input inputMode="decimal" className="num-mono" value={draft.validation?.max ?? ""} onChange={(e) => set("validation", { ...draft.validation, max: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
              </>}
              {TEXTY.includes(type) && <>
                <Field label={t("maxLengthLabel")}><Input inputMode="numeric" className="num-mono" value={draft.validation?.maxLength ?? ""} onChange={(e) => set("validation", { ...draft.validation, maxLength: e.target.value === "" ? undefined : Number(e.target.value) })} /></Field>
                {type !== "long_text" && <Field label={t("patternLabel")} help={t("patternHelp")} error={issues.validation}><Input className="num-mono" value={draft.validation?.pattern ?? ""} onChange={(e) => set("validation", { ...draft.validation, pattern: e.target.value || undefined })} /></Field>}
              </>}
              {type === "money" && <p className="self-end pb-2 text-12 text-ink-3">{t("moneyNote")}</p>}
            </div>
          )}

          {defaultDef && !["user", "lookup"].includes(type) && (
            <FieldInput def={{ ...defaultDef, key: "default", label: { en: t("defaultLabel") }, required: false }} value={draft.default} onChange={(v) => set("default", v)} error={issues.default} />
          )}

          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="label-caps mb-1">{t("rulesTitle")}</legend>
            {([["required", "ruleRequired"], ["uniqueInWorkspace", "ruleUnique"], ["isPii", "rulePii"], ["isFilterable", "ruleFilterable"], ["isSearchable", "ruleSearchable"]] as const).map(([k, label]) => (
              <div key={k} className="flex items-start gap-2 text-13">
                <Checkbox id={`rule-${k}`} checked={draft[k] === true} onCheckedChange={(on) => set(k, on === true)} />
                <label htmlFor={`rule-${k}`}><span className="text-ink">{t(label)}</span><span className="block text-12 text-ink-3">{t(`${label}Help`)}</span></label>
              </div>
            ))}
            {issues.uniqueInWorkspace && <p role="alert" className="text-12 text-danger sm:col-span-2">{issues.uniqueInWorkspace}</p>}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="label-caps mb-1">{t("accessTitle")}</legend>
            <p className="text-12 text-ink-3">{t("accessHelp")}</p>
            {(["viewRoles", "editRoles"] as const).map((k) => (
              <div key={k} role="group" aria-label={t(k === "viewRoles" ? "whoSees" : "whoEdits")} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="w-28 text-13 text-ink">{t(k === "viewRoles" ? "whoSees" : "whoEdits")}</span>
                {p.roles.map((r) => (
                  <span key={r.value} className="flex items-center gap-1.5 text-13">
                    <Checkbox id={`${k}-${r.value}`} checked={(draft[k] ?? []).includes(r.value)} onCheckedChange={(on) => toggleRole(k, r.value, on === true)} />
                    <label htmlFor={`${k}-${r.value}`}>{r.label}</label>
                  </span>
                ))}
                {!(draft[k] ?? []).length && <span className="text-12 text-ink-3">{t("everyone")}</span>}
              </div>
            ))}
            <Field label={t("editPermLabel")} help={t("editPermHelp")} error={issues.editablePerm}>
              <Input className="num-mono" placeholder="leads.assign" value={draft.editablePerm ?? ""} onChange={(e) => set("editablePerm", e.target.value || null)} />
            </Field>
          </fieldset>

          {(needReason || reason) && (
            <Field label={t("reasonLabel")} help={t("reasonOptionsHelp")} error={issues.reason} required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="quiet" onClick={() => p.onOpenChange(false)} disabled={pending}>{t("cancel")}</Button>
            <Button type="submit" variant="primary" disabled={pending}>{pending ? t("saving") : editing ? t("saveChanges") : t("createField")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function uniqueKey(label: string, taken: string[], i: number): string {
  const base = keyFromLabel(label || `option_${i + 1}`);
  let k = base, n = 2;
  while (taken.includes(k)) k = `${base}_${n++}`.slice(0, 41);
  return k;
}
