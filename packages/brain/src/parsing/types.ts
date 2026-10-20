export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ParseWarning =
  | 'INVALID_FRONTMATTER'
  | 'FRONTMATTER_TOO_LARGE'
  | 'UNTERMINATED_FRONTMATTER'
  | 'INVALID_METADATA_FIELD'
  | 'MARKDOWN_LIMIT_EXCEEDED';
export type ParsedLink = {
  readonly kind: 'wikilink' | 'import';
  readonly rawTarget: string;
  readonly targetPath: string;
  readonly heading: string | undefined;
  readonly block: string | undefined;
  readonly displayAlias: string | undefined;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly line: number;
};
export type ParsedNote = {
  readonly sourceId: string;
  readonly path: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly frontmatter: Readonly<Record<string, JsonValue>>;
  readonly body: string;
  readonly bodyStartLine: number;
  readonly bodyStartOffset: number;
  readonly links: readonly ParsedLink[];
  readonly warnings: readonly ParseWarning[];
};
export type NoteParseResult =
  | { readonly ok: true; readonly value: ParsedNote }
  | {
      readonly ok: false;
      readonly error: { readonly code: 'INVALID_NOTE_INPUT' | 'NOTE_TOO_LARGE' };
    };
export type LinkCandidate = {
  readonly id: string;
  readonly sourceId: string;
  readonly path: string;
  readonly aliases: readonly string[];
};
export type LinkResolution = {
  readonly link: ParsedLink;
  readonly status: 'resolved' | 'unresolved' | 'ambiguous';
  readonly documentId?: string;
  readonly via?: 'path' | 'filename' | 'alias';
};
