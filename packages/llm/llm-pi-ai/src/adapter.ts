/**
 * Generic pi-ai-backed implementation of the Harness LLM seam.
 *
 * Each resolution produces one **immutable** snapshot — the profiles plus a
 * `Models` collection holding the `Provider` each route built — and an
 * operation captures a whole snapshot before its first `await`. A
 * configuration change builds a *new* collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy: it resolves the provider
 * when the stream is first consumed, which is after the credential await, so a
 * mutated collection would let a request that started under one configuration
 * finish under another — or fail with a provider that no longer exists. This is
 * what makes the seam's per-step call freeze (`llm.prepareCall()`) hold all the
 * way down: switching models mid-reply takes effect on the next step, never
 * inside the one in flight.
 *
 * A route naming a credential reference still resolves it through the harness
 * seam and passes it as the request's `apiKey` option, which pi-ai treats as
 * the highest-priority auth override — that is what keeps the fail-loud
 * reference semantics. Everything that override does not cover reaches pi-ai
 * through the collection's own auth: the credential store holds the records a
 * login wrote and a refresh rotates, and the auth context answers the ambient
 * questions a provider asks while resolving. Both are stable across snapshots,
 * so a configuration change rebuilds the collection without forgetting who is
 * signed in.
 *
 * @module dsh-llm-pi-ai/adapter
 */

import type {
  Api,
  AuthContext,
  CredentialStore,
  Model,
  Models,
  ModelThinkingLevel,
  MutableModels,
  SimpleStreamOptions,
  ThinkingLevelMap,
  ThinkingLevel,
} from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  ImageAttachmentAccess,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ReasoningEffortId as ReasoningEffortIdType,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
// Type-only: the Context merge behind `ctx.get('modelCatalog')`, plus the fact
// vocabulary this adapter reads one generation of.
import type {} from '@deepseek-ai/dsh-model-catalog'
import type { ModelFacts, ModelFactsView } from '@deepseek-ai/dsh-model-catalog'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { toPiContext } from './context.ts'
import type { DeclaredModelFacts, PiAiModality } from './catalog.ts'
import { THINKING_LEVELS } from './catalog.ts'
import { createModels, getSupportedThinkingLevels } from './models.ts'
import { toStreamChunks } from './stream.ts'

/** Narrow the SDK model union to the protocol whose compat owns these fields. */
function isOpenAICompletionsModel(model: Model<Api>): model is Model<'openai-completions'> {
  return model.api === 'openai-completions'
}

/** Whether a selectable declaration also contains an unsupported budget control. */
function hasBudgetControl(control: ModelFacts['reasoningControl']): boolean {
  return (control?.type === 'toggle' || control?.type === 'effort') && control.budget === true
}

/** Narrow one SDK JSON payload record without assuming an arbitrary object is indexable. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One resolution's frozen view: the profiles, the collection built from them, and the catalog generation. */
interface PiAiSnapshot {
  /** The resolved profiles this collection was built from, used as its identity. */
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Providers for exactly those profiles; never mutated once published. */
  models: Models
  /**
   * The shared catalog generation this collection was built under, or
   * undefined when no catalog is mounted. Part of the snapshot's identity, so
   * a refresh rebuilds the collection rather than leaving an operation to
   * describe a model from one generation and encode it from the next.
   */
  facts: ModelFactsView | undefined
}

/** Constructor options for {@link PiAiAdapter}: the two resolution hooks the plugin owns. */
export interface PiAiAdapterOptions {
  /** Current validated profiles by provider route; called once per operation. */
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /**
   * Resolve the credential for one already-resolved profile; called once per
   * stream call and frozen for that call. `undefined` defers to the route's own
   * pi-ai auth, which for an installed catalog route is its provider-native
   * ambient discovery; the plugin allows that only for a profile naming no
   * credential at all, because a named reference that misses throws `LlmError`
   * `MISSING_CREDENTIAL` rather than falling back.
   */
  resolveApiKey: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<string | undefined>
  /**
   * How every collection this adapter builds resolves auth the request-level
   * `apiKey` override does not cover. Required rather than optional: a
   * collection built without them gets pi-ai's in-memory default store, which
   * is empty at every boot and discarded on every configuration change, so a
   * route whose only method is a login would report itself unconfigured on
   * every request no matter how often the human signed in.
   */
  auth: PiAiAuthInjection
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
  /** Bridge one attachment reference into the current model-tool execution world. */
  resolveImageAccess?: (attachments: AttachmentStore, ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined
  /**
   * Observe one assistant history message degrading to provider-neutral
   * conversion because its stored replay state is unusable by this build.
   */
  onReplayDegrade?: (detail: { provider: string; model: string; reason: string }) => void
  /**
   * The shared catalog generation in force, or undefined when no catalog is
   * mounted. Called once per operation and compared by identity: a refresh
   * returns a new view, which rebuilds the collection so that one operation
   * describes a model and encodes it from the same facts. Absent, every model
   * keeps exactly the facts pi-ai's installed catalog carries.
   */
  modelFacts?: () => ModelFactsView | undefined
}

/** The two auth injectables a pi-ai collection is built with. */
export interface PiAiAuthInjection {
  /** Durable storage for credentials pi-ai itself writes: logins, and the refreshes it runs under its own lock. */
  credentials: CredentialStore
  /** Ambient lookups a provider performs while resolving its own auth. */
  authContext: AuthContext
}

/** Copy profile stream knobs into pi-ai's common option vocabulary. */
function profileOptions(
  profile: ResolvedPiAiProviderProfile,
  reasoning: ModelThinkingLevel | undefined,
  apiKey: string | undefined,
  model: Model<Api>,
  control: ModelFacts['reasoningControl'],
): SimpleStreamOptions {
  const enabledReasoning: ThinkingLevel | undefined = reasoning === 'off' ? undefined : reasoning
  const toggleControl = control?.type === 'toggle'
    || (control?.type === 'effort' && control.toggle === true)
  const budgetControl = hasBudgetControl(control)
  const updateNested = (
    payload: Record<string, unknown>,
    key: string,
    field: string,
    value: unknown,
  ): Record<string, unknown> => {
    const current = payload[key]
    const nested = isRecord(current)
      ? { ...current }
      : {}
    const updated = Object.fromEntries(Object.entries(nested).filter(([name]) => name !== field))
    if (value !== undefined) updated[field] = value
    if (Object.keys(updated).length === 0) {
      return Object.fromEntries(Object.entries(payload).filter(([name]) => name !== key))
    }
    return { ...payload, [key]: updated }
  }
  return {
    ...apiKey === undefined ? {} : { apiKey },
    ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
    ...!toggleControl || budgetControl ? {} : {
      onPayload: (payload: unknown): unknown => {
        if (!isRecord(payload)) return payload
        let next = { ...payload }
        if (model.api === 'anthropic-messages') {
          if (reasoning === undefined) {
            next = updateNested(next, 'output_config', 'effort', undefined)
            delete next.thinking_budget_tokens
            next = updateNested(next, 'thinking', 'type', undefined)
            next = updateNested(next, 'thinking', 'budget_tokens', undefined)
          } else if (reasoning === 'off') {
            next = updateNested(next, 'output_config', 'effort', undefined)
            delete next.thinking_budget_tokens
            next = updateNested(next, 'thinking', 'budget_tokens', undefined)
            next = updateNested(next, 'thinking', 'type', 'disabled')
          } else if (control.type === 'toggle') {
            next = updateNested(next, 'output_config', 'effort', undefined)
            delete next.thinking_budget_tokens
            next = updateNested(next, 'thinking', 'budget_tokens', undefined)
            next = updateNested(next, 'thinking', 'type', 'adaptive')
          }
        } else if (isOpenAICompletionsModel(model) && model.compat?.thinkingFormat === undefined) {
          if (reasoning === undefined) {
            delete next.reasoning_effort
            next = updateNested(next, 'thinking', 'type', undefined)
          } else if (reasoning === 'off') {
            delete next.reasoning_effort
            next = updateNested(next, 'thinking', 'type', 'disabled')
          } else if (control.type === 'toggle') {
            delete next.reasoning_effort
            next = updateNested(next, 'thinking', 'type', 'adaptive')
          }
        } else if (model.api === 'openai-responses' && reasoning === undefined) {
          next = updateNested(next, 'reasoning', 'effort', undefined)
          delete next.reasoning_effort
        }
        return next
      },
    },
    ...profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: profile.thinkingBudgets },
    ...profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention },
    ...profile.transport === undefined ? {} : { transport: profile.transport },
    ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
    ...profile.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs },
    // The agent recovery layer owns visible attempts; one adapter call is one SDK attempt.
    maxRetries: 0,
  }
}

/**
 * The request modalities this exact route can carry, in descriptor order.
 *
 * The shared record describes the model and overrides a local declaration for
 * every field it carries; a field it leaves unset falls back to what this
 * profile declaration, then to the installed catalog. The effective descriptor
 * is registered with pi-ai, so discovery and requests use the same modality list.
 * @param model - the resolved model descriptor.
 * @param facts - the shared facts for this route and model, when a catalog is mounted.
 * @param declared - the facts this profile declared for the model, when any.
 * @returns the modalities to describe the model with.
 */
function effectiveModalities(
  model: Model<Api>,
  facts: ModelFacts | undefined,
  declared: DeclaredModelFacts | undefined,
): readonly PiAiModality[] {
  // The route profile supplies a fallback when the shared record is silent;
  // it does not narrow a model capability the current record names.
  if (facts?.inputModalities !== undefined) return [...facts.inputModalities]
  if (declared?.inputModalities !== undefined) return [...declared.inputModalities]
  return [...model.input]
}

/** Whether pi-ai's selected protocol encoder accepts an explicit effort. */
function canEncodeReasoningEffort(model: Model<Api>): boolean {
  if (!isOpenAICompletionsModel(model)) return true
  if (model.compat === undefined) return true
  return model.compat.supportsReasoningEffort !== false
    || model.compat.thinkingFormat === 'openrouter'
    || model.compat.thinkingFormat === 'ant-ling'
    || model.compat.thinkingFormat === 'string-thinking'
}

/** The accepted model facts applied to the descriptor pi-ai uses for this call. */
function modelWithFacts(
  model: Model<Api>,
  facts: ModelFacts | undefined,
  declared: DeclaredModelFacts | undefined,
): Model<Api> {
  const input = effectiveModalities(model, facts, declared)
  const contextWindow = facts?.contextWindow ?? declared?.contextWindow ?? model.contextWindow
  const maxTokens = facts?.maxOutputTokens === undefined
    ? model.maxTokens
    : Math.min(model.maxTokens, facts.maxOutputTokens)
  if (facts?.reasoning === false || facts?.reasoningControl?.type === 'none') {
    if (facts.reasoning === false) {
      return { ...model, input: [...input], contextWindow, maxTokens, reasoning: false }
    }
    const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(THINKING_LEVELS.map(level => [level, null]))
    return { ...model, input: [...input], contextWindow, maxTokens, thinkingLevelMap }
  }
  if (facts?.reasoningControl?.budget === true) {
    return { ...model, input: [...input], contextWindow, maxTokens }
  }
  if (facts?.reasoningControl?.type === 'toggle') {
    const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(
      THINKING_LEVELS.map(level => [level, level === 'off' ? 'none' : level === 'high' ? 'high' : null]),
    )
    const compat = model.api === 'anthropic-messages'
      ? { ...model.compat, forceAdaptiveThinking: true }
      : model.compat
    return {
      ...model,
      input: [...input],
      contextWindow,
      maxTokens,
      reasoning: true,
      thinkingLevelMap,
      ...(compat === undefined ? {} : { compat }),
    }
  }
  if (facts?.reasoningEfforts === undefined) return { ...model, input: [...input], contextWindow, maxTokens }

  const wireValues = new Map<ModelThinkingLevel, string>()
  for (const value of facts.reasoningEfforts) {
    const level: ModelThinkingLevel = value === 'none' ? 'off' : value as ModelThinkingLevel
    if (value !== 'none' && !THINKING_LEVELS.includes(value as ModelThinkingLevel)) continue
    const existing = model.thinkingLevelMap?.[level]
    if (model.thinkingLevelMap !== undefined && existing === null) continue
    wireValues.set(level, typeof existing === 'string' ? existing : value)
  }
  if (facts.reasoningControl?.type === 'effort' && facts.reasoningControl.toggle === true) {
    wireValues.set('off', 'none')
  }
  const thinkingLevelMap: ThinkingLevelMap = Object.fromEntries(
    THINKING_LEVELS.map(level => [level, wireValues.get(level) ?? null]),
  )
  const profileDenied = declared?.reasoning === false
  const compat = model.api === 'anthropic-messages' && facts.reasoningControl?.type === 'effort'
    ? { ...model.compat, forceAdaptiveThinking: true }
    : isOpenAICompletionsModel(model)
      && facts.reasoningControl?.type === 'effort'
      && model.compat?.supportsReasoningEffort !== false
      ? { ...model.compat, supportsReasoningEffort: true }
      : model.compat
  return {
    ...model,
    input: [...input],
    contextWindow,
    maxTokens,
    reasoning: !profileDenied && canEncodeReasoningEffort(model),
    thinkingLevelMap,
    ...(compat === undefined ? {} : { compat }),
  }
}

/**
 * The reasoning levels this exact route can put on the wire.
 *
 * The shared record outranks a local declaration: what the channel serving this
 * model declares it accepts replaces a vocabulary the profile wrote, and a
 * record that says the model does not reason denies every level. A field the
 * record leaves unset falls back to the profile's own declaration, then to what
 * the transport encodes. The transport always has the last word, so the answer
 * is an intersection with pi-ai's encodable set: a level neither side takes is
 * never offered and never sent, and a channel's declared list can only narrow
 * what the protocol already allows.
 * @param model - the resolved model descriptor.
 * @param facts - the shared facts for this route and model, when a catalog is mounted.
 * @param declared - the facts this profile declared for the model, when any.
 * @returns the encodable levels in pi-ai's escalation order.
 */
function encodableLevels(
  model: Model<Api>,
  facts: ModelFacts | undefined,
  declared: DeclaredModelFacts | undefined,
): ModelThinkingLevel[] {
  const effective = modelWithFacts(model, facts, declared)
  if (facts?.reasoning === false) return []
  if (hasBudgetControl(facts?.reasoningControl)) {
    if (!effective.reasoning) return []
    const nativeLevels = getSupportedThinkingLevels(effective)
    if (declared?.reasoningEfforts === undefined) return nativeLevels
    const declaredLevels = new Set(declared.reasoningEfforts)
    return nativeLevels.filter(level => declaredLevels.has(level))
  }
  if (!effective.reasoning || !canEncodeReasoningEffort(effective)) return []
  const levels = getSupportedThinkingLevels(effective)
  if (facts?.reasoningEfforts !== undefined) return levels
  if (declared?.reasoningEfforts !== undefined) {
    const own = new Set(declared.reasoningEfforts)
    return levels.filter(level => own.has(level))
  }
  // A shared positive reasoning flag carries no selectable level list. Keep
  // a custom route's local `false` descriptor from turning that flag into a
  // generic menu of levels the directory never advertised.
  if (facts?.reasoning === true && !model.reasoning) return []
  return levels
}

/**
 * The profile default this exact model can actually take, for DESCRIBING it.
 * A configured level the model does not support yields none rather than
 * throwing: `resolveModel` builds the model catalog, and a catalog that fails
 * takes its whole provider out of every picker — so one mis-set profile field
 * would hide every model on the route, including the ones that support the
 * level. The request path still refuses, which is where a bad configuration
 * belongs: describing what a model can do must not fail because a deployment
 * asked it for something it cannot.
 * @param model - the resolved model descriptor.
 * @param levels - the levels this route can encode.
 * @param effort - the profile's configured level, if any.
 * @returns the level when this model encodes it, otherwise undefined.
 */
function describableReasoningLevel(
  levels: readonly ModelThinkingLevel[],
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
  control: ModelFacts['reasoningControl'],
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  if (effort === 'on' && control?.type === 'toggle' && levels.includes('high')) return 'high'
  return levels.includes(effort as ModelThinkingLevel) ? effort as ModelThinkingLevel : undefined
}

/**
 * Validate an explicit Harness/profile effort without invoking pi-ai's clamp.
 * @param model - the resolved model descriptor, for the refusal message.
 * @param levels - the levels this route can encode.
 * @param effort - the requested level, if any.
 * @returns the level to send, or undefined when the caller named none.
 * @throws when the caller named a level this route cannot encode.
 */
function resolveReasoningLevel(
  model: Model<Api>,
  levels: readonly ModelThinkingLevel[],
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
  control: ModelFacts['reasoningControl'],
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  if (effort === 'on' && control?.type === 'toggle' && levels.includes('high')) return 'high'
  if (levels.includes(effort as ModelThinkingLevel)) return effort as ModelThinkingLevel
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Selectable reasoning efforts for one model, or nothing at all.
 *
 * A model that carries no reasoning metadata — every hand-declared one, and
 * every catalog model pi-ai marks as non-reasoning — is reported by pi-ai as
 * supporting the single level `off`. Passing that through would offer a control
 * that cannot do what it says: `off` is translated to *omitting* the reasoning
 * option, which for such a model is byte-for-byte the same request as naming no
 * effort — so a provider whose own default is to think would keep thinking with
 * `off` selected. Omitting `reasoning` entirely is the seam's way of saying the
 * capability is unavailable, which leaves the surface offering only the
 * provider's default.
 * @param model - the resolved model descriptor.
 * @param facts - the shared facts for this route and model, when a catalog is mounted.
 * @param declared - the facts this profile declared for the model, when any.
 * @param levels - the levels this route can encode.
 * @param defaultLevel - the profile's configured effort, already validated.
 * @returns the `reasoning` field, or an empty object when none can be offered.
 */
function reasoningInfo(
  model: Model<Api>,
  facts: ModelFacts | undefined,
  declared: DeclaredModelFacts | undefined,
  levels: readonly ModelThinkingLevel[],
  defaultLevel: ModelThinkingLevel | undefined,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  // The shared record outranks the installed catalog and a profile's own
  // declaration: a model the record says does not reason offers no level at
  // all, whatever the transport could encode or the profile declared, while a
  // record that leaves the capability open falls back to the declaration and
  // then to what pi-ai knows.
  if (!(facts?.reasoning ?? declared?.reasoning ?? model.reasoning)) return {}
  // The shared record and the transport can name disjoint sets. The runtime
  // rejects an empty effort list, and no offered level would be encodable, so
  // the model reports no reasoning control at all.
  if (levels.length === 0) return {}
  return {
    reasoning: {
      ...!hasBudgetControl(facts?.reasoningControl)
        && (facts?.reasoningControl?.type === 'toggle' || facts?.reasoningControl?.type === 'effort')
        ? { control: facts.reasoningControl.type }
        : {},
      efforts: (facts?.reasoningControl?.type === 'toggle' && !hasBudgetControl(facts.reasoningControl)
        ? levels.map(level => level === 'high' ? 'on' : level)
        : levels).map(level => ({
        id: ReasoningEffortId(level),
        name: level === 'on' ? 'Enabled' : `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...defaultLevel === undefined ? {} : {
        defaultEffort: ReasoningEffortId(
          facts?.reasoningControl?.type === 'toggle'
            && !hasBudgetControl(facts.reasoningControl)
            && defaultLevel === 'high'
            ? 'on'
            : defaultLevel,
        ),
      },
    },
  }
}

/** Merge deployment headers while removing case-insensitive attribution collisions. */
function requestHeaders(headers: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}

/**
 * pi-ai-backed multi-provider adapter. Each operation reads the current
 * profiles, so a configuration change reaches the next request without a
 * restart; model descriptors come from the collection those profiles built.
 */
export class PiAiAdapter extends LlmAdapter {
  private snapshot: PiAiSnapshot | undefined

  constructor(private readonly config: PiAiAdapterOptions) {
    super()
  }

  /**
   * The snapshot for the current profiles and catalog generation. Resolution
   * memoizes its result, so an unchanged configuration and an unchanged
   * generation are recognized by identity; either one changing gets a
   * brand-new collection, leaving any snapshot an operation already captured
   * untouched for as long as that operation holds it.
   */
  private current(): PiAiSnapshot {
    const profiles = this.config.profiles()
    const facts = this.config.modelFacts?.()
    if (this.snapshot?.profiles === profiles && this.snapshot.facts === facts) return this.snapshot
    const models: MutableModels = createModels(this.config.auth)
    for (const [provider, profile] of profiles) {
      const source = profile.piProvider
      if (source === undefined) continue
      const entries = source.getModels().map(model => modelWithFacts(
        model,
        facts?.facts({
          model: model.id,
          ownedBy: provider,
          apiURL: model.baseUrl,
        }),
        profile.declaredFacts.get(model.id),
      ))
      models.setProvider({ ...source, getModels: () => entries })
    }
    this.snapshot = { profiles, models, facts }
    return this.snapshot
  }

  /**
   * The shared facts for one exact route and model, or undefined when no
   * catalog is mounted or the catalog has no unambiguous record. The route id
   * selects exact provider aliases, and the descriptor's API URL lets a custom
   * route match an unambiguous published provider endpoint.
   * @param snapshot - the frozen view this operation captured.
   * @param provider - the route id.
   * @param model - the route-local model id.
   * @returns the facts, or undefined.
   */
  private factsOf(snapshot: PiAiSnapshot, provider: string, model: string): ModelFacts | undefined {
    const descriptor = snapshot.models.getModel(provider, model)
    return snapshot.facts?.facts({
      model,
      ownedBy: provider,
      ...descriptor?.baseUrl === undefined ? {} : { apiURL: descriptor.baseUrl },
    })
  }

  /** The profile for one route within one snapshot, or the not-owned failure. */
  private profileOf(snapshot: PiAiSnapshot, provider: string): ResolvedPiAiProviderProfile {
    const profile = snapshot.profiles.get(provider)
    if (profile === undefined) {
      throw new LlmError(`pi-ai adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return profile
  }

  /** The configured descriptor for one exact route/model pair within one snapshot. */
  private modelOf(snapshot: PiAiSnapshot, provider: string, model: string): Model<Api> {
    const profile = this.profileOf(snapshot, provider)
    const failure = profile.modelErrors.get(model)
      ?? (profile.piProvider === undefined ? profile.catalogError : undefined)
    if (failure !== undefined) throw new LlmError(failure, 'INVALID_CONFIG')
    const resolved = snapshot.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(`pi-ai provider "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    }
    return resolved
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // The configured name, not the route key: `displayName` exists so a
    // deployment can label a route, and a label only the configuration surface
    // reads would leave every selector showing the raw key.
    return { id: provider, name: this.current().profiles.get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.current().profiles.get(provider)?.retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(() => {
      const snapshot = this.current()
      const profile = this.profileOf(snapshot, provider)
      // Listed from the same facts `resolveModel` describes, so a picker never
      // offers a modality the exact-model lookup would then refuse.
      return snapshot.models.getModels(provider).map(model => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: effectiveModalities(
          model,
          this.factsOf(snapshot, provider, model.id),
          profile.declaredFacts.get(model.id),
        ),
      }))
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const snapshot = this.current()
      return this.modelInfo(snapshot, provider, model)
    })
  }

  private modelInfo(snapshot: PiAiSnapshot, provider: string, model: string): LlmResolvedModelInfo {
    const profile = this.profileOf(snapshot, provider)
    const resolvedModel = this.modelOf(snapshot, provider, model)
    const facts = this.factsOf(snapshot, provider, model)
    const declared = profile.declaredFacts.get(model)
    const levels = encodableLevels(resolvedModel, facts, declared)
    const defaultLevel = describableReasoningLevel(levels, profile.reasoning, facts?.reasoningControl)
    // Only a cap the deployment configured is a request default; the
    // catalog's `maxTokens` sizes the model and stops there.
    const configuredMaxTokens = profile.configuredMaxTokens.get(model)
    return {
      provider,
      id: model,
      name: resolvedModel.name,
      inputModalities: resolvedModel.input,
      context: { contextWindow: resolvedModel.contextWindow },
      ...configuredMaxTokens === undefined ? {} : { defaultMaxTokens: configuredMaxTokens },
      ...reasoningInfo(resolvedModel, facts, declared, levels, defaultLevel),
    }
  }

  override prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const snapshot = this.current()
    return Promise.resolve({
      model: this.modelInfo(snapshot, provider, model),
      stream: options => this.streamWithSnapshot(options, snapshot),
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithSnapshot(options, this.current())
  }

  private async * streamWithSnapshot(
    options: GenerateOptions,
    snapshot: PiAiSnapshot,
  ): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('llm-pi-ai does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    // One capture per stream call, taken before any await: the profile, the
    // model descriptor, and the collection all come from the same immutable
    // snapshot, and the credential freezes with them. A configuration change
    // mid-request builds a separate snapshot, so this request finishes under
    // the one it started with and the next call picks up the new one.
    const profile = this.profileOf(snapshot, options.provider)
    const model = this.modelOf(snapshot, options.provider, options.model)
    const facts = this.factsOf(snapshot, options.provider, options.model)
    const declared = profile.declaredFacts.get(options.model)
    const requestedReasoning = options.reasoningEffort ?? profile.reasoning
    const reasoning = resolveReasoningLevel(
      model,
      encodableLevels(model, facts, declared),
      requestedReasoning,
      facts?.reasoningControl,
    )
    // The catalog's output ceiling is a capability, not a request default: it
    // never becomes one here. It does bound what a default may claim, and
    // refusing says which model would have rejected the request instead of
    // leaving the provider to answer with an opaque error.
    const ceiling = facts?.maxOutputTokens
    if (ceiling !== undefined && options.maxTokens !== undefined && options.maxTokens > ceiling) {
      throw new LlmError(
        `pi-ai provider "${model.provider}" model "${model.id}" produces at most ${ceiling} output`
        + ` tokens, and the request asks for ${options.maxTokens}`,
        'UNSUPPORTED_OPTION',
      )
    }
    const apiKey = await this.config.resolveApiKey(options.provider, profile)

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs
    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = options.messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('pi-ai image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const onReplayDegrade = (reason: string): void => {
        this.config.onReplayDegrade?.({ provider: options.provider, model: options.model, reason })
      }
      const context = attachments === undefined
        ? toPiContext(options, undefined, onReplayDegrade)
        : await toPiContext({ ...options, signal: watchdog.signal }, {
          attachments,
          resolveImageAccess: ref => this.config.resolveImageAccess?.(attachments, ref),
          maxRequestImageBytes: profile.maxRequestImageBytes,
          requestImagePolicy: {
            maxPixels: profile.requestImagePixelBudget,
            maxBytes: profile.requestImageMaxBytes,
          },
        }, onReplayDegrade)
      const events = snapshot.models.streamSimple(model, context, {
        ...profileOptions(profile, reasoning, apiKey, model, facts?.reasoningControl),
        ...options.temperature === undefined ? {} : { temperature: options.temperature },
        ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        signal: watchdog.signal,
        // Profile headers are deployment-owned; attribution names are
        // Harness-owned and therefore win collisions.
        headers: requestHeaders(profile.headers),
      })
      const iterator = toStreamChunks(events, model.contextWindow, options.signal, model.id)[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          const timeout = timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')
          if (timeout !== undefined) throw timeout
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('pi-ai stream consumer stopped')
          try {
            await iterator.return(undefined)
          } catch (_abortedSdkTeardown) {
            // The stable signal already owns SDK termination; return-time abort cannot add an outcome.
          }
        }
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`pi-ai stream idle timeout after ${streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('pi-ai stream consumer stopped')
    }
  }
}
