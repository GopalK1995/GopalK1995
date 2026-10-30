export interface ExplainView { allow: boolean; reason: string | null; step: number; steps: { step: number; name: string; passed: boolean; detail: string }[] }
