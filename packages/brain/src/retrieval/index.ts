export { compareFused, fuseRankings, MAX_FUSED_RESULTS, RRF_CONSTANT } from './fuse.ts';
export type { FusedCandidate, FuseOptions, LexicalHit, VectorHit } from './fuse.ts';
export { applyEvidenceGates, evidenceGatesSchema, freezeGates, passesGates } from './gates.ts';
export type { EvidenceGates, GatedResult, SearchMode } from './gates.ts';
export {
  calibrateEvidenceGates,
  CalibrationInputError,
  calibrationSetSchema,
} from './calibrate.ts';
export type { CalibrationReport, CalibrationSet } from './calibrate.ts';
