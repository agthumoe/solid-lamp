// Internal module entry; the brain package bootstrap owns its public root exports.
export { parseNote } from './parse-note.ts';
export { resolveNoteLinks } from './resolve-links.ts';
export type {
  ParsedNote,
  ParsedLink,
  NoteParseResult,
  ParseWarning,
  LinkCandidate,
  LinkResolution,
  JsonValue,
} from './types.ts';
