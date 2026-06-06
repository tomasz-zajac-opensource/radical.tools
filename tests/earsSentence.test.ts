import { describe, it, expect } from 'vitest'
import { composeEarsSentence, resolveEarsSubject } from '../src/renderer/src/types/metamodel'

describe('composeEarsSentence', () => {
  it('ubiquitous with subject: "<Subject> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'ubiquitous', action: 'respond within 1s' }, 'the API Gateway')
    expect(sentence).toBe('The API Gateway shall respond within 1s.')
    expect(complete).toBe(true)
  })

  it('ubiquitous without subject defaults to "the system"', () => {
    const { sentence } = composeEarsSentence({ ears_type: 'ubiquitous', action: 'respond within 1s' })
    expect(sentence).toBe('The system shall respond within 1s.')
  })

  it('ubiquitous incomplete (no action)', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'ubiquitous' })
    expect(sentence).toContain('‹action›')
    expect(complete).toBe(false)
  })

  it('event-driven: "When <trigger>, <subject> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'event-driven', trigger: 'a request is received', action: 'validate input' }, 'the API')
    expect(sentence).toBe('When a request is received, the API shall validate input.')
    expect(complete).toBe(true)
  })

  it('event-driven incomplete (missing trigger)', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'event-driven', action: 'validate' })
    expect(sentence).toContain('‹trigger›')
    expect(complete).toBe(false)
  })

  it('state-driven: "While <precondition>, <subject> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'state-driven', precondition: 'the system is running', action: 'log metrics' }, 'the Monitor')
    expect(sentence).toBe('While the system is running, the Monitor shall log metrics.')
    expect(complete).toBe(true)
  })

  it('unwanted-behaviour: "If <condition>, then <subject> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'unwanted-behaviour', unwanted_condition: 'disk is full', action: 'alert admin' }, 'the System')
    expect(sentence).toBe('If disk is full, then the System shall alert admin.')
    expect(complete).toBe(true)
  })

  it('optional: "Where <feature>, <subject> shall <action>."', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'optional', feature: 'offline mode is enabled', action: 'cache data locally' }, 'the App')
    expect(sentence).toBe('Where offline mode is enabled, the App shall cache data locally.')
    expect(complete).toBe(true)
  })

  it('complex: combines precondition + trigger', () => {
    const { sentence, complete } = composeEarsSentence({ ears_type: 'complex', precondition: 'in degraded mode', trigger: 'a new request arrives', action: 'queue request' }, 'the Service')
    expect(sentence).toBe('While in degraded mode, when a new request arrives, the Service shall queue request.')
    expect(complete).toBe(true)
  })

  it('defaults to ubiquitous for unknown type', () => {
    const { sentence } = composeEarsSentence({ action: 'do something' })
    expect(sentence).toBe('The system shall do something.')
  })
})

describe('resolveEarsSubject', () => {
  it('returns source label from satisfies relation', () => {
    const relations = { r1: { sourceId: 'sys1', targetId: 'req1', relationType: 'satisfies' } }
    const nodes = { sys1: { label: 'Payment Service' }, req1: { label: 'REQ-001' } }
    expect(resolveEarsSubject('req1', relations, nodes)).toBe('Payment Service')
  })

  it('returns undefined when no satisfies relation exists', () => {
    const relations = { r1: { sourceId: 'sys1', targetId: 'req1', relationType: 'derives' } }
    const nodes = { sys1: { label: 'Payment Service' }, req1: { label: 'REQ-001' } }
    expect(resolveEarsSubject('req1', relations, nodes)).toBeUndefined()
  })
})
