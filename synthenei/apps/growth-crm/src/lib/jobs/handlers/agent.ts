// agent queue consumer stub (MVP2 hook, BUILD-PLAN 1.10). The queue exists and is empty on Monday.
// Any message that does reach it is acknowledged and recorded in job_runs only; nothing executes and nothing is written elsewhere.
import { registerHandler, type JobHandler } from "../registry";

export const acknowledgeAgentMessage: JobHandler<unknown> = async (_payload, ctx) => {
  ctx.log.info("agent queue message acknowledged (MVP2 consumer not installed)");
  return "done";
};

// "*" is the queue wildcard, so unknown consumers routed to the agent queue are acknowledged too.
registerHandler("agent", "*", acknowledgeAgentMessage);
