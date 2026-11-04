// UI and result copy for pipeline administration (namespace `pipelinesAdmin`, CONTRACTS C13). English only for now:
// moving it into messages/<locale>/pipelinesAdmin.json is a follow-up (see docs/tasks/T032.md). Nouns for the record
// ("deal", "lead") are passed in by callers from the tenant vocabulary, never written here.
export const PT = {
  pageTitle: "Pipelines", pageSub: "Stages, win probability, colour, time limits and the fields a record must have before it enters a stage.",
  conflictTitle: "Someone else changed these stages", conflictBody: "Reload to see the latest version, then make your change again.",
  auditFailed: "Saved, but the audit entry could not be written. Tell an administrator.",
  pipelineNeedsName: "Give the pipeline a name.", pipelineNameLong: "Pipeline names are at most 40 characters.", pipelineNameTaken: "Another pipeline already has that name.",
  pipelineNameBad: "That name cannot be turned into a pipeline id. Use letters or digits.", pipelineGone: "That pipeline no longer exists.", stageGone: "One of those stages no longer exists.",
  leadSingle: "Leads use one pipeline per workspace.", defaultKeeps: "The default pipeline cannot be archived. Make another pipeline the default first.",
  pipelineLimit: (n: number) => `At most ${n} extra pipelines.`,
  pipelineInUse: (name: string) => `${name} still has records in open stages. Move them first, then archive it.`,
  stageInUse: (name: string) => `${name} still has records in it. Move them to another stage first, then archive it.`,
  keyLocked: "A stage's internal id never changes. Rename it instead.", keyTaken: "Two stages ended up with the same id. Rename one and save again.",
  nothingChanged: "Nothing changed.",
  pipelineCreated: (n: string) => `Pipeline "${n}" created`, pipelineRenamed: (n: string) => `Renamed to "${n}"`,
  pipelineArchived: (n: string) => `"${n}" archived`, pipelineRestored: (n: string) => `"${n}" restored`,
  stagesSaved: (n: string) => `Stages saved for "${n}"`,
  demoNotSaved: "Demo workspace: kept in this browser only.", denied: "You do not have permission to change pipelines.", deniedSupport: "Pipelines cannot be changed in a read-only support session.",
  errorTitle: "Could not save pipelines", errorBody: "Nothing was changed. Try again in a moment.",
  invalidBody: "Some values are not valid.",
  requiredMissing: (stage: string, fields: string[]) => `Cannot move to ${stage}: fill in ${fields.join(", ")} first.`,
} as const;
