/** Standard ACP session configuration over one Agent's model selection. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionConfigOption, SessionConfigValueId } from '@agentclientprotocol/sdk'
import { installModelSelection, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import {
  isModelReasoningEffort, modelReasoningEfforts, ReasoningEffortId,
  type LlmCallConfig, type LlmRuntime,
} from '@deepseek-ai/dsh-llm'

const MODEL_CONFIG_ID = 'model'
const REASONING_CONFIG_ID = 'reasoning_effort'
// DSH reasoning effort ids are non-empty, so the empty opaque ACP value is a disjoint provider-default choice.
const PROVIDER_DEFAULT_REASONING_VALUE = ''

interface ModelChoice {
  selection: ModelSelection
  value: SessionConfigValueId
}

interface ConfigState {
  choices: Map<SessionConfigValueId, ModelSelection>
  options: SessionConfigOption[]
}

/** Caller-correctable session configuration failure. */
export class AcpModelConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpModelConfigError'
  }
}

/** Project and mutate one Agent's provider/model/reasoning selection through ACP config options. */
export class AcpModelControl {
  /** Scoped selection reference consumed by Agent request assembly. */
  readonly selection: ModelSelectionRef
  private tail = Promise.resolve()
  private selected: ModelSelection | undefined
  private turnSelection: { turn: number; selection: ModelSelection } | undefined
  private hasResolvedState = false

  constructor(
    private readonly llm: LlmRuntime,
    initial: ModelSelection | undefined,
  ) {
    this.selected = initial
    const getCurrent = (): ModelSelection | undefined => this.turnSelection?.selection ?? this.selected
    const setCurrent = (value: ModelSelection | undefined): void => { this.selected = value }
    this.selection = {
      get current() { return getCurrent() },
      set current(value) { setCurrent(value) },
      assembled: undefined,
    }
  }

  /**
   * Install request/prompt consistency listeners in the unpublished Agent scope.
   * @param agentCtx - Agent scope that consumes this selection.
   */
  install(agentCtx: Context): void {
    installModelSelection(agentCtx, this.selection)
  }

  /**
   * Snapshot the selection attached to the next accepted ACP prompt.
   * @returns a detached future selection, or undefined when listeners supply the route.
   */
  snapshot(): ModelSelection | undefined {
    return this.selected === undefined ? undefined : { ...this.selected }
  }

  /**
   * Pin one admitted ACP message's selection for every step in its turn.
   * @param turn - admitted Agent turn.
   * @param selection - exact prompt-admission selection.
   */
  pinTurn(turn: number, selection: ModelSelection): void {
    this.turnSelection = { turn, selection: { ...selection } }
  }

  /**
   * Release only the exact completed turn's routing override.
   * @param turn - completed Agent turn.
   */
  releaseTurn(turn: number): void {
    if (this.turnSelection?.turn === turn) this.turnSelection = undefined
  }

  /**
   * Return the complete standard config-option state after prior mutations settle.
   * @param signal - optional catalog and exact-model cancellation.
   * @returns all current standard configuration options.
   */
  options(signal?: AbortSignal): Promise<SessionConfigOption[]> {
    return this.serialize(async () => (await this.state(signal)).options)
  }

  /**
   * Set one advertised option and return the complete resulting option state.
   * @param configId - standard option id.
   * @param value - opaque selected value returned by a previous option state.
   * @param signal - optional catalog and exact-model cancellation.
   * @returns all standard options after the serialized mutation.
   */
  set(configId: string, value: unknown, signal?: AbortSignal): Promise<SessionConfigOption[]> {
    return this.serialize(async () => {
      if (typeof value !== 'string') throw new AcpModelConfigError(`${configId} requires a select value`)
      const current = this.selected
      if (current === undefined) throw new AcpModelConfigError('this session has no model selection')
      if (configId === MODEL_CONFIG_ID) {
        const state = await this.state(signal)
        const selected = state.choices.get(value)
        if (selected === undefined) throw new AcpModelConfigError(`unknown model option: ${value}`)
        // A new route starts from the harness default again: the level chosen
        // for the previous model was a choice about that model.
        this.selected = await this.resolveRoute(selected, signal)
      } else if (configId === REASONING_CONFIG_ID) {
        // The ladder is the fixed harness vocabulary, not the route's own set,
        // so a level this route cannot encode is stored as chosen here and
        // refused by the request that carries it as
        // `UNSUPPORTED_REASONING_EFFORT` — the same explicit failure a person
        // gets from the browser selector, never a silent drop to a
        // neighboring level.
        if (value !== PROVIDER_DEFAULT_REASONING_VALUE && !isModelReasoningEffort(value)) {
          throw new AcpModelConfigError(`unknown reasoning effort for ${current.provider}/${current.model}: ${value}`)
        }
        const route = await this.resolveRoute(current, signal)
        this.selected = {
          provider: route.provider,
          model: route.model,
          ...value === PROVIDER_DEFAULT_REASONING_VALUE
            ? {}
            : { reasoningEffort: ReasoningEffortId(value) },
        }
      } else {
        throw new AcpModelConfigError(`unknown session config option: ${configId}`)
      }
      return (await this.state(signal)).options
    })
  }

  /** Keep concurrent client mutations in receive order without wedging after rejection. */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Build detached model choices and the dependent reasoning option. */
  private async state(signal?: AbortSignal): Promise<ConfigState> {
    const selected = this.selected
    if (selected === undefined) return { choices: new Map(), options: [] }
    let resolved: ModelSelection
    try {
      resolved = await this.resolveRoute(selected, signal)
      this.hasResolvedState = true
    } catch (error: unknown) {
      if (!this.hasResolvedState) throw error
      resolved = selected
    }
    const choices = new Map<SessionConfigValueId, ModelSelection>()
    const groups = await Promise.all(this.llm.listProviders().map(async (provider) => {
      try {
        const models = await this.llm.listModels(provider.id)
        const entries = models.map((model) => {
          const choice: ModelChoice = {
            value: modelValue(provider.id, model.id),
            selection: { provider: provider.id, model: model.id },
          }
          choices.set(choice.value, choice.selection)
          return {
            value: choice.value,
            name: model.name,
            ...model.description === undefined ? {} : { description: model.description },
          }
        })
        return { group: provider.id, name: provider.name, options: entries }
      } catch (_providerCatalogUnavailable) {
        return { group: provider.id, name: provider.name, options: [] }
      }
    }))
    const currentValue = modelValue(resolved.provider, resolved.model)
    if (!choices.has(currentValue)) {
      choices.set(currentValue, { provider: resolved.provider, model: resolved.model })
      let group = groups.find(item => item.group === resolved.provider)
      if (group === undefined) {
        group = { group: resolved.provider, name: resolved.provider, options: [] }
        groups.push(group)
      }
      group.options.unshift({ value: currentValue, name: resolved.model })
    }
    const options: SessionConfigOption[] = [{
      id: MODEL_CONFIG_ID,
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue,
      options: groups.filter(group => group.options.length > 0),
    }]
    // The ladder is offered for every model, on a route that could not be
    // resolved included: a person picking a level is naming what the model
    // should do, and the refusal comes from the request. The current value
    // reports the stored intent, so a route that materializes its own default
    // does not report a level the person never picked.
    options.push({
      id: REASONING_CONFIG_ID,
      name: 'Reasoning effort',
      category: 'thought_level',
      type: 'select',
      currentValue: selected.reasoningEffort !== undefined
        && isModelReasoningEffort(selected.reasoningEffort)
        ? selected.reasoningEffort
        : PROVIDER_DEFAULT_REASONING_VALUE,
      options: [
        { value: PROVIDER_DEFAULT_REASONING_VALUE, name: 'Default' },
        ...modelReasoningEfforts().map(effort => ({ value: effort.id, name: effort.name })),
      ],
    })
    return { choices, options }
  }

  /**
   * Prove one exact route resolves, without judging the effort stored beside it.
   *
   * Selection is where a person names what they want, and capability belongs to
   * the request that carries it out. A level this route cannot encode is
   * therefore kept as the stored intent and refused by the request as
   * `UNSUPPORTED_REASONING_EFFORT`, and the Default row stores no effort at all
   * rather than the level a route would materialize for it.
   * @param selection - the exact route to prove, with any stored intent.
   * @param signal - optional cancellation for the capability lookup.
   * @returns the exact provider and model the next request will use.
   */
  private async resolveRoute(selection: ModelSelection, signal?: AbortSignal): Promise<ModelSelection> {
    const resolved: LlmCallConfig = await this.llm.resolveCallConfig(
      { provider: selection.provider, model: selection.model },
      signal,
    )
    return { provider: resolved.provider, model: resolved.model }
  }
}

/** Opaque ACP selector value carrying the full route identity. */
function modelValue(provider: string, model: string): SessionConfigValueId {
  return JSON.stringify([provider, model])
}
