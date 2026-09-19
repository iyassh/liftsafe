// A pack is the set of movements a kind of business starts its shift with.
// Adapting LiftSafe to a new business is a new entry here plus any new movement specs.
export const DEFAULT_PACK = 'warehouse';

export const PACKS = {
  warehouse: {
    name: 'Warehouse',
    blurb: 'Picking, packing and loading',
    warmup: ['overheadReach', 'squat', 'hipHinge'],
  },
  movers: {
    name: 'Movers & delivery',
    blurb: 'Heavy, awkward loads all day',
    warmup: ['hipHinge', 'squat', 'overheadReach'],
  },
  retail: {
    name: 'Retail & stocking',
    blurb: 'Shelves, backroom and overhead stock',
    warmup: ['overheadReach', 'hipHinge', 'squat'],
  },
};

// Roadmap modules. Shown greyed out and labelled; never presented as built.
export const COMING_SOON = [
  { name: 'Overhead work', blurb: 'Stocking, painting, drywall' },
  { name: 'Patient handling', blurb: 'Care homes and home care' },
  { name: 'Housekeeping', blurb: 'Hotels and cleaning crews' },
  { name: 'Workstation tasks', blurb: 'Assembly, food prep, bakeries' },
];
