import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("evaluate Parshendi Petitions", { hours: 1 }, internal.diplomacy.refreshPetitions, {});

crons.cron("process active Highstorm exposure", "* * * * *", internal.highstorms.processActiveStorm, {});
crons.interval("recover overdue Conflict Board events", { minutes: 5 }, internal.conflictBoards.recoverDue, {});

crons.cron(
  "open scheduled Plateau Runs",
  "*/5 * * * *",
  internal.plateauRuns.maybeStartScheduledPlateauRun,
  {},
);

crons.interval(
  "settle Gemheart Plateau yields",
  { minutes: 15 },
  internal.economy.settleGemheartPlateaus,
  {},
);

crons.interval(
  "clean old notifications",
  { hours: 24 },
  internal.notifications.cleanupOld,
  {},
);

crons.interval(
  "deliver subtle Spren reports",
  { hours: 6 },
  internal.spren.deliverReports,
  {},
);

export default crons;
