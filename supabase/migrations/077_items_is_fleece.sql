-- Move the Fleece flag from costing-only state (jobs.costing_data.costProds[].isFleece)
-- to a first-class item attribute. ProductBuilder now sets this where the blank is
-- assigned, since fleece-ness is a property of the garment, not the costing run.
-- Existing jobs continue to honor their legacy in-costing isFleece value via merge
-- logic in CostingTab — this just gives ProductBuilder a place to write to.

alter table items add column if not exists is_fleece boolean default false;
