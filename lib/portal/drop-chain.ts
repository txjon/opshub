// The drop planner's core trick: the date chain run BACKWARD from the
// release date. Web-live minus prep, transit, press time, blanks, and
// costing/approval = the last responsible moment for each step. Defaults
// are honest planning constants (tunable; per-vendor lead times can feed
// this later via decorators.lead_time_days / transit_defaults).
export const CHAIN_DEFAULTS = {
  webPrepDays: 3,      // dock → entered/live-ready
  transitDays: 5,      // vendor → dock
  pressDays: 15,       // on press → ships
  blanksDays: 7,       // POs out → blanks landed / on press
  costingDays: 7,      // greenlight → costed + quoted + POs out
};

export type ChainStep = { key: string; label: string; date: string };

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function backwardChain(targetLiveDate: string, d = CHAIN_DEFAULTS): ChainStep[] {
  const live = new Date(targetLiveDate + "T00:00").getTime();
  const DAY = 86400000;
  const dock = live - d.webPrepDays * DAY;
  const ships = dock - d.transitDays * DAY;
  const press = ships - d.pressDays * DAY;
  const pos = press - d.blanksDays * DAY;
  const greenlight = pos - d.costingDays * DAY;
  return [
    { key: "greenlight", label: "greenlight by", date: iso(greenlight) },
    { key: "pos", label: "POs out", date: iso(pos) },
    { key: "press", label: "on press", date: iso(press) },
    { key: "ships", label: "ships", date: iso(ships) },
    { key: "dock", label: "at the dock", date: iso(dock) },
    { key: "live", label: "web-live", date: iso(live) },
  ];
}
