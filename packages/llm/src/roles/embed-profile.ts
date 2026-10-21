// Embedding profiles (ADR 0006, #94): an immutable identity for one embedding space. The
// inference process derives its approved profiles from models.yaml (the embed role and the
// explicit fallback options) plus the installed Ollama artifact digests; callers name a profile
// by its opaque ID and never send model tags or prefixes.
import { createHash } from 'node:crypto';

import type { ModelsConfig } from '@aetherion/shared';

import type { EmbedSnapshot } from './resolve-role.ts';

export { EMBEDDING_PROFILE_ID } from '../rpc/contract.ts';

export type EmbeddingProfileIdentity = {
  readonly model: string;
  readonly dimensions: number;
  readonly numCtx: number;
  readonly queryPrefix: string;
  readonly documentPrefix: string;
};

export type EmbeddingProfile = EmbeddingProfileIdentity & {
  readonly id: string;
  // SHA-256 of the installed model artifact (Ollama's digest), lower-case hex.
  readonly digest: string;
};

// Deterministic: the same artifact, dimensions, context and prefixes always give the same ID,
// and any change (including a re-pulled artifact with a new digest) gives a different one.
export const embeddingProfileId = (identity: EmbeddingProfileIdentity, digest: string): string =>
  `ep-${createHash('sha256')
    .update(
      JSON.stringify([
        identity.model,
        digest,
        identity.dimensions,
        identity.numCtx,
        identity.queryPrefix,
        identity.documentPrefix,
      ]),
    )
    .digest('hex')
    .slice(0, 24)}`;

/** Profile candidates from config: the embed role first (the default), then fallback options. */
export const embeddingProfileCandidates = (config: ModelsConfig): EmbeddingProfileIdentity[] => {
  const role = config.roles.embed;
  const candidates: EmbeddingProfileIdentity[] = [
    {
      model: role.model,
      dimensions: role.dimensions,
      numCtx: role.num_ctx,
      queryPrefix: role.query_prefix,
      documentPrefix: role.document_prefix,
    },
  ];
  for (const [model, option] of Object.entries(config.fallback_embedding_options))
    candidates.push({
      model,
      dimensions: option.dimensions,
      numCtx: option.num_ctx,
      queryPrefix: option.query_prefix,
      documentPrefix: option.document_prefix,
    });
  return candidates;
};

export const snapshotFromProfile = (profile: EmbeddingProfile): EmbedSnapshot =>
  Object.freeze({
    kind: 'embed',
    role: 'embed',
    model: profile.model,
    numCtx: profile.numCtx,
    dimensions: profile.dimensions,
    queryPrefix: profile.queryPrefix,
    documentPrefix: profile.documentPrefix,
  });
