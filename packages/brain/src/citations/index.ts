export { formatCitation, parseDisplayCitation } from './display.ts';
export type { DisplayCitation, DisplayParseResult } from './display.ts';
export { checkCitation, headingOccurrences } from './resolve.ts';
export type { CitationCheck, CurrentChunk } from './resolve.ts';
export {
  MAX_DISPLAY_LENGTH as MAX_CITATION_DISPLAY_LENGTH,
  structuredCitationSchema,
} from './structured.ts';
export type { StructuredCitation } from './structured.ts';
