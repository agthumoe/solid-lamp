// The trusted embedding-profile registry (ADR 0006, #94). Profiles come only from
// operator-controlled models.yaml (the embed role and explicit fallback options) combined with
// the digests of artifacts actually installed in Ollama. Nothing a caller sends can add one.
import {
  embeddingProfileCandidates,
  embeddingProfileId,
  inferenceError,
  type EmbeddingProfile,
  type InferenceError,
} from '@aetherion/llm';
import { err, ok, type ModelsConfig, type Result } from '@aetherion/shared';

import { canonicalModel } from '../ollama/residency.ts';

export type InstalledArtifacts = (
  signal: AbortSignal,
) => Promise<Result<ReadonlyMap<string, string>, InferenceError>>;

export type ProfileListing = {
  readonly defaultProfileId: string | null;
  readonly profiles: readonly EmbeddingProfile[];
};

const unavailable = (message: string) => err(inferenceError('PROFILE_UNAVAILABLE', message));

export const createProfileRegistry = (deps: {
  readonly config: () => ModelsConfig;
  readonly installed: InstalledArtifacts;
}) => {
  const list = async (signal: AbortSignal): Promise<Result<ProfileListing, InferenceError>> => {
    // Read the config before the first await: the snapshot is the config at the moment of the
    // call, so a reload while Ollama's model list is fetched cannot change the vector space.
    const candidates = embeddingProfileCandidates(deps.config());
    const installed = await deps.installed(signal);
    if (!installed.ok) return installed;
    const profiles: EmbeddingProfile[] = [];
    let defaultProfileId: string | null = null;
    for (const [index, identity] of candidates.entries()) {
      const digest = installed.value.get(canonicalModel(identity.model));
      if (!digest) continue; // not installed: not approved
      const profile = Object.freeze({
        ...identity,
        id: embeddingProfileId(identity, digest),
        digest,
      });
      profiles.push(profile);
      if (index === 0) defaultProfileId = profile.id;
    }
    return ok({ defaultProfileId, profiles });
  };

  return {
    list,
    /** A pinned profile by ID, or the embed role's current profile when no ID is given. */
    resolve: async (
      profileId: string | undefined,
      signal: AbortSignal,
    ): Promise<Result<EmbeddingProfile, InferenceError>> => {
      const listing = await list(signal);
      if (!listing.ok) return listing;
      const id = profileId ?? listing.value.defaultProfileId;
      const profile = listing.value.profiles.find((candidate) => candidate.id === id);
      if (profile) return ok(profile);
      return unavailable(
        profileId === undefined
          ? 'the embed role model is not installed'
          : 'embedding profile is not approved or its artifact changed',
      );
    },
    /** Re-checks, right before running, that the profile's artifact is still the installed one. */
    verify: async (
      profile: EmbeddingProfile,
      signal: AbortSignal,
    ): Promise<Result<true, InferenceError>> => {
      const installed = await deps.installed(signal);
      if (!installed.ok) return installed;
      return installed.value.get(canonicalModel(profile.model)) === profile.digest
        ? ok(true)
        : unavailable('embedding profile artifact is missing or was replaced');
    },
  };
};

export type ProfileRegistry = ReturnType<typeof createProfileRegistry>;
