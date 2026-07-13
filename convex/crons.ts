import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.cron(
  "open scheduled Plateau Runs",
  "*/5 * * * *",
  internal.plateauRuns.maybeStartScheduledPlateauRun,
  {},
);

export default crons;
