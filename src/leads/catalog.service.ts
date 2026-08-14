import type { LeadChannel, LeadSource, LeadStage } from '@prisma/client';
import { ApiError } from '../utils/api-error';
import type { AuthenticatedUser } from '../users/user.types';
import { DEFAULT_STAGE_KEY, FALLBACK_SOURCE_KEY, defaultSourceKeyForChannel } from './lead.constants';
import * as repository from './lead.repository';
import type { SourceWithCounts, StageWithCounts } from './lead.repository';
import type {
  CreateLeadSourceInput,
  CreateLeadStageInput,
  ListLeadSourcesQuery,
  UpdateLeadSourceInput,
  UpdateLeadStageInput,
} from './lead.validation';

/**
 * The pipeline catalogue: where leads come from, and the columns they move
 * through.
 *
 * ## Tenancy
 *
 * Everything in the lead engine is confined to `user.organizationId`, with no
 * `organization.manage_all` escape hatch. That is deliberate and differs from
 * the organizations module: a merged pipeline across tenants is not a view
 * anybody wants — the stages do not line up, and a funnel computed over two
 * companies' leads is meaningless. A platform administrator who needs to see a
 * customer's pipeline is given an account in that customer's organization.
 */

/** Machine keys are lower_snake_case; slugs elsewhere in the app use hyphens. */
export function keyify(value: string): string {
  const key = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '');

  return key.length > 0 ? key : 'item';
}

/**
 * Resolves a key that is free within the organization, appending a counter on
 * collision. Advisory only — the unique index is the real guarantee, and a lost
 * race surfaces as P2002, which the error handler maps to 409.
 */
async function availableKey(
  organizationId: string,
  base: string,
  lookup: (organizationId: string, key: string) => Promise<{ id: string } | null>,
): Promise<string> {
  if (!(await lookup(organizationId, base))) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!(await lookup(organizationId, candidate))) return candidate;
  }

  throw ApiError.conflict(`Could not derive a free key from "${base}" — supply one explicitly`);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function listSources(
  user: AuthenticatedUser,
  query: ListLeadSourcesQuery,
): Promise<SourceWithCounts[]> {
  await repository.ensureDefaults(user.organizationId);
  return repository.listSources(user.organizationId, {
    includeInactive: query.includeInactive,
    channel: query.channel,
  });
}

export async function getSourceById(
  user: AuthenticatedUser,
  id: string,
): Promise<SourceWithCounts> {
  const source = await repository.findSourceById(user.organizationId, id);
  // 404 rather than 403 across tenants — see src/utils/tenant.ts.
  if (!source) throw ApiError.notFound('Lead source not found');
  return source;
}

export async function createSource(
  user: AuthenticatedUser,
  input: CreateLeadSourceInput,
): Promise<LeadSource> {
  await repository.ensureDefaults(user.organizationId);

  const requested = input.key;
  if (requested) {
    const taken = await repository.findSourceByKey(user.organizationId, requested);
    if (taken) throw ApiError.conflict(`The source key "${requested}" is already in use`);
  }

  const key =
    requested ?? (await availableKey(user.organizationId, keyify(input.name), repository.findSourceByKey));

  return repository.createSource({
    organizationId: user.organizationId,
    key,
    name: input.name,
    channel: input.channel,
    description: input.description,
  });
}

export async function updateSource(
  user: AuthenticatedUser,
  id: string,
  input: UpdateLeadSourceInput,
): Promise<SourceWithCounts> {
  const source = await getSourceById(user, id);

  // A system source is the fallback capture writes to when an integration names
  // no source, so it must stay reachable. Renaming it is fine; switching it off
  // would send the next webhook nowhere.
  if (source.isSystem && input.isActive === false) {
    throw ApiError.conflict(
      `"${source.name}" is a system source and cannot be deactivated — capture falls back to it.`,
    );
  }

  return repository.updateSource(id, input);
}

export async function deleteSource(user: AuthenticatedUser, id: string): Promise<void> {
  const source = await getSourceById(user, id);

  if (source.isSystem) {
    throw ApiError.conflict(
      `"${source.name}" is a system source and cannot be deleted. Deactivate it instead.`,
    );
  }

  const leads = await repository.countLeadsFromSource(id);
  if (leads > 0) {
    throw ApiError.conflict(
      `${leads} lead(s) came from "${source.name}". Deleting it would erase their attribution — deactivate it instead.`,
    );
  }

  await repository.deleteSource(id);
}

/**
 * Picks the source a new lead belongs to.
 *
 * Three ways in, in descending order of precision: an explicit id, an explicit
 * key, or the channel's default source. The last is what makes capture work
 * with no setup — a webhook says "I am WhatsApp" and the lead lands in the
 * WhatsApp source, created on demand if it is missing.
 */
export async function resolveSource(
  organizationId: string,
  hint: { sourceId?: string | undefined; sourceKey?: string | undefined; channel?: LeadChannel | undefined },
): Promise<LeadSource> {
  if (hint.sourceId) {
    const source = await repository.findSourceById(organizationId, hint.sourceId);
    if (!source) throw ApiError.notFound('Lead source not found');
    if (!source.isActive) {
      throw ApiError.validation('Validation failed', [
        { field: 'sourceId', message: `"${source.name}" is not accepting new leads` },
      ]);
    }
    return source;
  }

  const key = hint.sourceKey ?? (hint.channel ? defaultSourceKeyForChannel(hint.channel) : FALLBACK_SOURCE_KEY);

  const source = await repository.findSourceByKey(organizationId, key);
  if (source) return source;

  // An explicitly named key that does not exist is a caller mistake worth
  // reporting; a derived one just means defaults have not been provisioned yet.
  if (hint.sourceKey) {
    throw ApiError.validation('Validation failed', [
      { field: 'sourceKey', message: `No lead source with key "${hint.sourceKey}"` },
    ]);
  }

  await repository.ensureDefaults(organizationId);
  const provisioned = await repository.findSourceByKey(organizationId, key);
  if (!provisioned) throw ApiError.internal('Default lead sources are missing');
  return provisioned;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export async function listStages(user: AuthenticatedUser): Promise<StageWithCounts[]> {
  await repository.ensureDefaults(user.organizationId);
  return repository.listStages(user.organizationId);
}

export async function getStageById(user: AuthenticatedUser, id: string): Promise<StageWithCounts> {
  const stage = await repository.findStageById(user.organizationId, id);
  if (!stage) throw ApiError.notFound('Pipeline stage not found');
  return stage;
}

export async function createStage(
  user: AuthenticatedUser,
  input: CreateLeadStageInput,
): Promise<LeadStage> {
  await repository.ensureDefaults(user.organizationId);

  const requested = input.key;
  if (requested) {
    const taken = await repository.findStageByKey(user.organizationId, requested);
    if (taken) throw ApiError.conflict(`The stage key "${requested}" is already in use`);
  }

  const key =
    requested ?? (await availableKey(user.organizationId, keyify(input.name), repository.findStageByKey));

  const position = input.position ?? (await repository.highestStagePosition(user.organizationId)) + 1;

  return repository.createStage({
    organizationId: user.organizationId,
    key,
    name: input.name,
    description: input.description,
    position,
    type: input.type,
  });
}

export async function updateStage(
  user: AuthenticatedUser,
  id: string,
  input: UpdateLeadStageInput,
): Promise<StageWithCounts> {
  await getStageById(user, id);
  return repository.updateStage(id, input);
}

export async function deleteStage(user: AuthenticatedUser, id: string): Promise<void> {
  const stage = await getStageById(user, id);

  if (stage.isSystem) {
    throw ApiError.conflict(
      `"${stage.name}" is a system stage and cannot be deleted — the journey engine and the funnel are defined in terms of it.`,
    );
  }

  const leads = await repository.countLeadsInStage(id);
  if (leads > 0) {
    throw ApiError.conflict(
      `${leads} lead(s) are in "${stage.name}". Move them to another stage before deleting it.`,
    );
  }

  await repository.deleteStage(id);
}

/** Resolves a stage by id or key, defaulting to the top of the pipeline. */
export async function resolveStage(
  organizationId: string,
  hint: { stageId?: string | undefined; stageKey?: string | undefined },
): Promise<LeadStage> {
  if (hint.stageId) {
    const stage = await repository.findStageById(organizationId, hint.stageId);
    if (!stage) throw ApiError.notFound('Pipeline stage not found');
    return stage;
  }

  const key = hint.stageKey ?? DEFAULT_STAGE_KEY;
  const stage = await repository.findStageByKey(organizationId, key);
  if (stage) return stage;

  if (hint.stageKey) {
    throw ApiError.validation('Validation failed', [
      { field: 'stageKey', message: `No pipeline stage with key "${hint.stageKey}"` },
    ]);
  }

  await repository.ensureDefaults(organizationId);
  const provisioned = await repository.findStageByKey(organizationId, key);
  if (!provisioned) throw ApiError.internal('Default pipeline stages are missing');
  return provisioned;
}
