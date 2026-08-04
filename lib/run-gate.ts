// Has a piece actually been RUN? One rule, both sides of the glass (Jon,
// Aug 4: an intake item showed as "produced" in the catalog — it hadn't run).
//
// A greenlit-but-unrun design is a PRODUCT — it lives in the products catalog
// with Run it / Order this. It only joins produced history once its job truly
// entered production, or the item itself carries a pipeline stage (covers
// items printed on jobs that later went sideways).
export const RUN_PHASES = new Set(["production", "receiving", "fulfillment", "complete"]);
export const hasRun = (jobPhase?: string | null, pipelineStage?: string | null): boolean =>
  RUN_PHASES.has(String(jobPhase || "")) || !!pipelineStage;
