import { describe, it, expect } from 'vitest'
import { composeEarsSentence } from '../src/renderer/src/types/metamodel'

describe('composeEarsSentence', () => {
  it('ubiquitous: "The <system> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'System', ears_type: 'ubiquitous', action: 'respond within 1s' })
    expect(sentence).toBe('The System shall respond within 1s.')
    expect(complete).toBe(true)
  })

  it('ubiquitous incomplete (no action)', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'System', ears_type: 'ubiquitous' })
    expect(sentence).toContain('‹action›')
    expect(complete).toBe(false)
  })

  it('event-driven: "When <trigger>, the <system> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'API', ears_type: 'event-driven', trigger: 'a request is received', action: 'validate input' })
    expect(sentence).toBe('When a request is received, the API shall validate input.')
    expect(complete).toBe(true)
  })

  it('event-driven incomplete (missing trigger)', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'API', ears_type: 'event-driven', action: 'validate' })
    expect(sentence).toContain('‹trigger›')
    expect(complete).toBe(false)
  })

  it('state-driven: "While <precondition>, the <system> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'Monitor', ears_type: 'state-driven', precondition: 'the system is running', action: 'log metrics' })
    expect(sentence).toBe('While the system is running, the Monitor shall log metrics.')
    expect(complete).toBe(true)
  })

  it('unwanted-behaviour: "If <condition>, then the <system> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'System', ears_type: 'unwanted-behaviour', unwanted_condition: 'disk is full', action: 'alert admin' })
    expect(sentence).toBe('If disk is full, then the System shall alert admin.')
    expect(complete).toBe(true)
  })

  it('optional: "Where <feature>, the <system> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'App', ears_type: 'optional', feature: 'offline mode is enabled', action: 'cache data locally' })
    expect(sentence).toBe('Where offline mode is enabled, the App shall cache data locally.')
    expect(complete).toBe(true)
  })

  it('complex: combines precondition + trigger', () => {
    const { sentence, complete } = composeEarsSentence({ label: 'Service', ears_type: 'complex', precondition: 'in degraded mode', trigger: 'a new request arrives', action: 'queue request' })
    expect(sentence).toBe('While in degraded mode, when a new request arrives, the Service shall queue request.')
    expect(complete).toBe(true)
  })

  it('defaults to ubiquitous for unknown type', () => {
    const { sentence } = composeEarsSentence({ label: 'X', action: 'do something' })
    expect(sentence).toBe('The X shall do something.')
  })
})
