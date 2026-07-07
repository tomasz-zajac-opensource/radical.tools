/**
 * Fintech Banking Platform — a sample C4 model demonstrating all capabilities:
 *  - All node types incl. governance: person, system, domain, container,
 *    component, database, webapp, queue, adr, fitness-fn
 *  - C4 + DDD + Governance metamodel (ADRs & Fitness Functions)
 *  - 7 named views:
 *      System Context · Core Banking · Payments Domain (static)
 *      Payment Flow (dynamic) · Platform Hierarchy (treemap)
 *      Dependency Matrix (matrix) · Governance (table)
 *  - 1 sequence: Payment Processing (ordered interaction steps)
 *  - 3 milestones tracking platform evolution
 *  - 1 presentation with 8 slides
 */

import type {
  DiagramData, C4Node, C4Relation, DiagramSequence, DiagramSnapshot, DiagramView,
  NodePosition, Presentation,
} from '../types/c4'
import { COLLAPSED_HEIGHT, COLLAPSED_WIDTH } from '../types/c4'
import { builtInGovernanceMetamodel } from '../types/metamodel'
import { runSmartLayout } from '../layout/smartLayoutRunner'
import savedSampleData from './fintechSampleData.json'

// ── helpers ──────────────────────────────────────────────────────────────────

function nd(
  id: string, type: C4Node['type'], label: string,
  description: string, technology: string,
  x: number, y: number, w: number, h: number,
  opts: Partial<Pick<C4Node, 'parentId' | 'external' | 'collapsed'>> = {},
): C4Node {
  return { id, type, label, description, technology, x, y, width: w, height: h, collapsed: false, ...opts }
}

function rl(id: string, src: string, tgt: string, label: string, tech = ''): C4Relation {
  return { id, sourceId: src, targetId: tgt, label, technology: tech }
}

/** Governance relation carrying an explicit metamodel relationType. */
function gr(id: string, src: string, tgt: string, relationType: string, label = ''): C4Relation {
  return { id, sourceId: src, targetId: tgt, relationType, label, technology: '' }
}

/** ADR governance node — carries MADR-style fields as extra props. */
function adrNode(id: string, label: string, x: number, y: number, props: Record<string, unknown>): C4Node {
  return { id, type: 'adr', label, x, y, width: 180, height: 52, collapsed: false, ...props } as C4Node
}

/** Fitness-function governance node — carries evolutionary-architecture fields. */
function ffNode(id: string, label: string, description: string, x: number, y: number, props: Record<string, unknown>): C4Node {
  return { id, type: 'fitness-fn', label, description, x, y, width: 180, height: 52, collapsed: false, ...props } as C4Node
}

// ── Layout helpers ────────────────────────────────────────────────────────────

/** Runs smart layout and applies the winning positions in-place to `nodes`. */
async function applyLayoutInPlace(
  nodes: Record<string, C4Node>,
  relations: Record<string, C4Relation>,
): Promise<void> {
  try {
    const result = await runSmartLayout(nodes, relations)
    if (result.candidates.length === 0) return
    for (const [id, pos] of Object.entries(result.winner.positions)) {
      const node = nodes[id]
      if (!node) continue
      node.x = pos.x
      node.y = pos.y
      if (pos.width)  node.width  = pos.width
      if (pos.height) node.height = pos.height
    }
  } catch (err) {
    console.warn('[fintechSample] smart layout failed, keeping default positions', err)
  }
}

/** Extracts a Record<id, NodePosition> from a node map. */
function recordToPos(nodes: Record<string, C4Node>): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {}
  for (const n of Object.values(nodes)) out[n.id] = { x: n.x, y: n.y, width: n.width, height: n.height }
  return out
}

/**
 * Builds a node subset for a view.  Systems/containers that have children in
 * the full model but none in this view are shown collapsed (use collapsed sizes,
 * no children passed to the layout engine).
 */
function buildViewSubset(
  viewNodeIds: string[],
  allNodes: Record<string, C4Node>,
): Record<string, C4Node> {
  const result: Record<string, C4Node> = {}
  for (const id of viewNodeIds) {
    const n = allNodes[id]
    if (!n) continue
    const hasChildrenInModel = Object.values(allNodes).some(c => c.parentId === id)
    const hasChildrenInView  = viewNodeIds.some(vid => allNodes[vid]?.parentId === id)
    const isViewCollapsed = hasChildrenInModel && !hasChildrenInView &&
                            (n.type === 'system' || n.type === 'container')
    result[id] = isViewCollapsed
      ? { ...n, width: COLLAPSED_WIDTH[n.type] ?? n.width, height: COLLAPSED_HEIGHT[n.type] ?? n.height }
      : { ...n }
  }
  return result
}

/** Filters relations to those whose both endpoints are in the given node map. */
function buildRelSubset(
  nodes: Record<string, C4Node>,
  allRels: C4Relation[],
): Record<string, C4Relation> {
  const nodeSet = new Set(Object.keys(nodes))
  const result: Record<string, C4Relation> = {}
  for (const r of allRels) {
    if (nodeSet.has(r.sourceId) && nodeSet.has(r.targetId)) result[r.id] = r
  }
  return result
}

// ── Build ─────────────────────────────────────────────────────────────────────

/**
 * All node + relation definitions (hardcoded initial positions — overridden by
 * the pre-computed layout stored in fintechSampleData.json).
 *
 * Node type coverage:
 *   person, system, domain, container, component, database, webapp, queue
 */
function _makeBaseData(): { allNodes: C4Node[]; allRels: C4Relation[] } {
  const allNodes: C4Node[] = [

    // ── Actors ────────────────────────────────────────────────────────────────
    nd('p-customer', 'person', 'Retail Customer',  'Individual banking customer accessing via web and mobile', '', -250, 200,  150, 170),
    nd('p-corp',     'person', 'Corporate Client', 'Business client using treasury and bulk-payment APIs',     '', -250, 440,  150, 170),
    nd('p-ops',      'person', 'Bank Operator',    'Internal staff managing operations and support',           '', -250, 670,  150, 170),

    // ── Core Banking Platform (system, contains 3 domains) ───────────────────
    nd('sys-core', 'system', 'Core Banking Platform',
      'Central microservices platform — all banking domain logic', 'Kubernetes / Istio',
      50, 0, 2200, 980),

    // Domain: Access & Security — API gateway + auth service
    nd('dom-access', 'domain', 'Access & Security',
      'API gateway, authentication and authorisation for all inbound traffic', 'Kong / Keycloak',
      60, 100, 700, 360, { parentId: 'sys-core' }),

    nd('ctn-apigw', 'container', 'API Gateway',
      'Routes all external traffic, enforces rate limits and TLS termination', 'Kong / Nginx',
      30, 110, 300, 200, { parentId: 'dom-access' }),

    nd('ctn-auth', 'container', 'Auth Service',
      'Issues JWT tokens and validates OIDC sessions', 'Keycloak / OAuth 2.0',
      370, 110, 300, 200, { parentId: 'dom-access' }),

    // Domain: Banking Services — payments (with components), accounts, event bus
    nd('dom-banking', 'domain', 'Banking Services',
      'Core financial domain — payments, accounts and event streaming', 'Java / Go',
      820, 100, 1260, 400, { parentId: 'sys-core' }),

    nd('ctn-payments', 'container', 'Payments Service',
      'Processes domestic and cross-border payment instructions', 'Go 1.22 / gRPC',
      30, 110, 480, 240, { parentId: 'dom-banking' }),

    nd('comp-validator', 'component', 'Payment Validator',
      'Validates payment rules, limits and IBAN format', 'Go / Rule Engine',
      20, 80, 200, 120, { parentId: 'ctn-payments' }),

    nd('comp-fx', 'component', 'FX Engine',
      'Applies real-time FX rates for cross-border payments', 'Go / Reuters Feed',
      260, 80, 200, 120, { parentId: 'ctn-payments' }),

    nd('ctn-accounts', 'container', 'Accounts Service',
      'Manages customer accounts, balances and statements', 'Java 21 / Spring Boot',
      570, 110, 300, 200, { parentId: 'dom-banking' }),

    nd('ctn-evtbus', 'queue', 'Event Bus',
      'Async domain-event streaming between all microservices', 'Apache Kafka 3.6',
      930, 165, 220, 95, { parentId: 'dom-banking' }),

    // Domain: Risk & Data — fraud detection + data stores
    nd('dom-risk', 'domain', 'Risk & Data',
      'Real-time fraud detection and persistent data stores', 'Python / PostgreSQL',
      60, 560, 880, 360, { parentId: 'sys-core' }),

    nd('ctn-fraud', 'container', 'Fraud Detection',
      'Real-time ML-based transaction risk scoring', 'Python 3.12 / XGBoost',
      30, 110, 300, 200, { parentId: 'dom-risk' }),

    nd('ctn-db-acc', 'database', 'Accounts DB',
      'Primary store for customer and account data', 'PostgreSQL 15 / Patroni',
      390, 145, 190, 130, { parentId: 'dom-risk' }),

    nd('ctn-db-tx', 'database', 'Transactions DB',
      'Immutable append-only ledger of all financial transactions', 'PostgreSQL 15 / Patroni',
      640, 145, 190, 130, { parentId: 'dom-risk' }),

    // ── Digital Channels (system, contains 2 webapps) ─────────────────────────
    nd('sys-channels', 'system', 'Digital Channels',
      'Customer-facing web portal and native mobile app', 'React / React Native',
      2360, 80, 270, 450),

    nd('ctn-web', 'webapp', 'Web Banking',
      'Full-featured banking portal for browsers', 'React 18 / TypeScript',
      30, 100, 210, 140, { parentId: 'sys-channels' }),

    nd('ctn-mobile', 'webapp', 'Mobile App',
      'Native banking app for iOS and Android', 'React Native / Expo',
      30, 300, 210, 140, { parentId: 'sys-channels' }),

    // ── External systems ──────────────────────────────────────────────────────
    nd('sys-swift', 'system', 'SWIFT Network',      'International wire transfer messaging',  'SWIFT MT / ISO 20022', 200,  1060, 360, 260, { external: true }),
    nd('sys-cards', 'system', 'Card Networks',       'Visa / Mastercard authorisation',        'ISO 8583 / Visa API',  620,  1060, 360, 260, { external: true }),
    nd('sys-kyc',   'system', 'KYC / AML Provider', 'Identity verification and AML screening', 'REST / JSON',          1040, 1060, 360, 260, { external: true }),

    // ── Governance: Architecture Decision Records (Nygard / MADR) ─────────────
    adrNode('adr-evt', 'ADR-001: Event-Driven Core', 2700, 0, {
      status: 'accepted', date: '2024-02-12',
      context: 'Synchronous service-to-service calls were creating tight coupling and cascading failures between payments, accounts and fraud.',
      decision: 'Introduce an Apache Kafka event bus and move all cross-domain communication to asynchronous domain events.',
      consequences: 'Looser coupling and independent scaling, at the cost of eventual consistency and the need for idempotent consumers.',
      alternatives: 'Synchronous gRPC mesh; shared database integration.',
    }),
    adrNode('adr-ledger', 'ADR-002: Immutable Ledger on PostgreSQL', 2700, 90, {
      status: 'accepted', date: '2024-03-04',
      context: 'Financial transactions must be auditable and tamper-evident for regulators.',
      decision: 'Store transactions in an append-only PostgreSQL ledger with Patroni replication; never update or delete rows.',
      consequences: 'Strong auditability and point-in-time reconstruction; table growth requires partitioning and archival.',
      alternatives: 'Mutable balance table; event-store-only persistence.',
    }),
    adrNode('adr-jwt', 'ADR-003: Stateless JWT Auth', 2700, 180, {
      status: 'accepted', date: '2024-01-20',
      context: 'Session affinity made horizontal scaling of the API tier difficult.',
      decision: 'Use short-lived signed JWT access tokens issued by Keycloak; validate at the gateway with no server-side session store.',
      consequences: 'Stateless, horizontally scalable auth; token revocation needs a short TTL plus a denylist.',
      alternatives: 'Server-side sessions in Redis; opaque tokens with introspection.',
    }),
    adrNode('adr-mono', 'ADR-000: Modular Monolith', 2700, 270, {
      status: 'superseded', date: '2023-09-01',
      context: 'The initial MVP needed to ship quickly with a small team.',
      decision: 'Build the platform as a single modular monolith deployed as one unit.',
      consequences: 'Fast early delivery, but scaling and team autonomy became bottlenecks as the platform grew.',
      alternatives: 'Microservices from day one.',
    }),

    // ── Governance: Fitness Functions (Building Evolutionary Architectures) ───
    ffNode('ff-latency', 'FF: Payment p99 < 250ms',
      'Continuously asserts that the end-to-end payment path stays within its latency budget.', 2900, 0, {
      category: 'operational', automated: true, trigger: 'continuous', status: 'active',
      threshold: 'p99 latency < 250ms measured over any rolling 24h window',
    }),
    ffNode('ff-ledger', 'FF: Zero ledger data loss',
      'Verifies the transaction ledger survives node failure with no committed-record loss.', 2900, 90, {
      category: 'structural', automated: true, trigger: 'on-deploy', status: 'active',
      threshold: 'No committed transaction lost during automated chaos / failover tests',
    }),
  ]

  // ── Relations ──────────────────────────────────────────────────────────────

  const allRels: C4Relation[] = [
    // Actors → channels / gateway
    rl('r-cust-web',    'p-customer',   'ctn-web',      'Views accounts & transfers',  'HTTPS / Browser'),
    rl('r-corp-web',    'p-corp',       'ctn-web',      'Bulk payments & treasury',    'HTTPS / Browser'),
    rl('r-ops-apigw',   'p-ops',        'ctn-apigw',    'Admin & support operations',  'HTTPS / Admin API'),

    // Channels → API Gateway
    rl('r-web-apigw',   'ctn-web',      'ctn-apigw',    'API calls', 'HTTPS / REST'),
    rl('r-mob-apigw',   'ctn-mobile',   'ctn-apigw',    'API calls', 'HTTPS / REST'),

    // API Gateway → services
    rl('r-apigw-auth',  'ctn-apigw',    'ctn-auth',     'Validates token',  'JWT / OIDC'),
    rl('r-apigw-pay',   'ctn-apigw',    'ctn-payments', 'Routes',           'HTTP/2 / gRPC'),
    rl('r-apigw-acc',   'ctn-apigw',    'ctn-accounts', 'Routes',           'HTTP/2 / gRPC'),

    // Services → data stores
    rl('r-pay-dbtx',    'ctn-payments', 'ctn-db-tx',    'Reads / writes', 'JDBC / SQL'),
    rl('r-acc-dbacc',   'ctn-accounts', 'ctn-db-acc',   'Reads / writes', 'JDBC / SQL'),

    // Event streaming
    rl('r-pay-evtbus',  'ctn-payments', 'ctn-evtbus',   'Publishes payment.completed', 'Kafka producer'),
    rl('r-acc-evtbus',  'ctn-accounts', 'ctn-evtbus',   'Publishes balance.updated',   'Kafka producer'),
    rl('r-evtbus-fraud','ctn-evtbus',   'ctn-fraud',    'Consumes all tx events',      'Kafka consumer'),

    // External integrations
    rl('r-pay-swift',   'ctn-payments', 'sys-swift',    'Sends wire transfers',       'SWIFT MT103'),
    rl('r-pay-cards',   'ctn-payments', 'sys-cards',    'Card authorisation',          'ISO 8583'),
    rl('r-acc-kyc',     'ctn-accounts', 'sys-kyc',      'Identity & AML screening',    'REST / JSON'),

    // ── Governance relations (constrains / supersedes / implements) ──────────
    gr('g-adrEvt-evtbus',  'adr-evt',    'ctn-evtbus',   'constrains', 'Async via events'),
    gr('g-adrEvt-pay',     'adr-evt',    'ctn-payments', 'constrains'),
    gr('g-adrLedger-dbtx', 'adr-ledger', 'ctn-db-tx',    'constrains', 'Append-only'),
    gr('g-adrJwt-auth',    'adr-jwt',    'ctn-auth',     'constrains', 'Stateless tokens'),
    gr('g-adrEvt-mono',    'adr-evt',    'adr-mono',     'supersedes'),
    gr('g-ffLat-pay',      'ff-latency', 'ctn-payments', 'constrains', 'Latency budget'),
    gr('g-ffLat-impl',     'ff-latency', 'adr-evt',      'implements'),
    gr('g-ffLedger-dbtx',  'ff-ledger',  'ctn-db-tx',    'constrains', 'Durability'),
    gr('g-ffLedger-impl',  'ff-ledger',  'adr-ledger',   'implements'),
  ]

  return { allNodes, allRels }
}

// ── Sequence ──────────────────────────────────────────────────────────────────

function _buildSequences(): DiagramSequence[] {
  return [{
    id: 'seq-payment-flow',
    name: 'Payment Processing',
    relationIds: [
      'r-cust-web', 'r-web-apigw', 'r-apigw-auth',
      'r-apigw-pay', 'r-pay-evtbus', 'r-evtbus-fraud', 'r-pay-swift',
    ],
    stepDescriptions: [
      'Customer initiates transfer',
      'Web app calls REST API',
      'Gateway validates JWT token',
      'Routes to Payments Service',
      'Publishes payment.completed event',
      'Fraud Detection scores transaction',
      'Sends wire via SWIFT',
    ],
  }]
}

// ── View node ID lists ─────────────────────────────────────────────────────────

// Context: top-level nodes only (sys-core & sys-channels auto-collapse)
const CTX_IDS = [
  'p-customer', 'p-corp', 'p-ops',
  'sys-core', 'sys-channels',
  'sys-swift', 'sys-cards', 'sys-kyc',
]

// Core banking: full hierarchy inside sys-core
const CORE_IDS = [
  'sys-core',
  'dom-access',  'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk',    'ctn-fraud', 'ctn-db-acc', 'ctn-db-tx',
]

// Payments domain: payment-relevant nodes across both systems
const PAY_IDS = [
  'p-customer',
  'sys-channels', 'ctn-web',
  'sys-core',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk',    'ctn-fraud', 'ctn-db-tx',
  'sys-swift', 'sys-cards',
]

// Payment flow: nodes involved in the sequence (for dynamic view)
const PAYFLOW_IDS = [
  'p-customer',
  'sys-channels', 'ctn-web',
  'sys-core',
  'dom-access',  'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-evtbus',
  'dom-risk',    'ctn-fraud',
  'sys-swift',
]

// Treemap: full platform hierarchy (no actors or externals)
const TREEMAP_IDS = [
  'sys-core',
  'dom-access',  'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk',    'ctn-fraud', 'ctn-db-acc', 'ctn-db-tx',
  'sys-channels', 'ctn-web', 'ctn-mobile',
]

// Matrix (DSM): the concrete services / stores that exchange traffic
const MATRIX_IDS = [
  'ctn-web', 'ctn-mobile', 'ctn-apigw', 'ctn-auth',
  'ctn-payments', 'ctn-accounts', 'ctn-evtbus', 'ctn-fraud',
  'ctn-db-acc', 'ctn-db-tx',
]

// Governance table: architecture + decisions + fitness functions together
const GOVERNANCE_IDS = [
  'sys-core',
  'dom-access',  'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk',    'ctn-fraud', 'ctn-db-acc', 'ctn-db-tx',
  'adr-evt', 'adr-ledger', 'adr-jwt', 'adr-mono',
  'ff-latency', 'ff-ledger',
]

// ── Milestone node / relation subsets ─────────────────────────────────────────

// v1 – MVP: API gateway + auth + accounts only
const V1_NODES = [
  'p-customer',
  'sys-channels', 'ctn-web',
  'sys-core', 'dom-access', 'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-accounts',
  'dom-risk', 'ctn-db-acc',
]
const V1_RELS = ['r-cust-web', 'r-web-apigw', 'r-apigw-auth', 'r-apigw-acc', 'r-acc-dbacc']

// v2 – add payments, events and SWIFT
const V2_NODES = [
  ...V1_NODES,
  'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-evtbus', 'ctn-db-tx', 'sys-swift',
]
const V2_RELS = [
  ...V1_RELS,
  'r-apigw-pay', 'r-pay-dbtx', 'r-pay-evtbus', 'r-acc-evtbus', 'r-pay-swift',
]

// ── Presentations ─────────────────────────────────────────────────────────────

function _buildPresentations(): Presentation[] {
  return [{
    id: 'pres-walkthrough',
    name: 'Architecture Walkthrough',
    slides: [
      { id: 'slide-ctx',      name: '1 – System Context',     snapshotId: null,       viewId: 'view-ctx',      viewport: { x: 300, y: 60,  zoom: 0.55 } },
      { id: 'slide-core',     name: '2 – Core Banking',        snapshotId: null,       viewId: 'view-core',     viewport: { x: 60,  y: 40,  zoom: 0.45 } },
      { id: 'slide-payments', name: '3 – Payments Domain',     snapshotId: null,       viewId: 'view-payments', viewport: { x: 100, y: 60,  zoom: 0.55 } },
      { id: 'slide-payflow',  name: '4 – Payment Flow',        snapshotId: null,       viewId: 'view-payflow',  viewport: { x: 100, y: 60,  zoom: 0.55 } },
      { id: 'slide-treemap',  name: '5 – Platform Hierarchy',  snapshotId: null,       viewId: 'view-treemap',  viewport: { x: 80,  y: 80,  zoom: 0.6  } },
      { id: 'slide-matrix',   name: '6 – Dependency Matrix',   snapshotId: null,       viewId: 'view-matrix',     viewport: { x: 0, y: 0, zoom: 1 } },
      { id: 'slide-governance', name: '7 – Governance',        snapshotId: null,       viewId: 'view-governance', viewport: { x: 0, y: 0, zoom: 1 } },
      { id: 'slide-v1',       name: '8 – v1 MVP (Milestone)',  snapshotId: 'snap-v1',  viewId: null,            viewport: { x: 200, y: 80,  zoom: 0.65 } },
    ],
  }]
}

/**
 * Reads the developer override file from disk at runtime via the dedicated
 * `dev:loadSample` IPC channel (bypasses the static Vite bundle cache).
 * Falls back to buildFintechSampleRaw() when no override is present or when
 * running outside Electron dev mode.
 */
export async function loadFintechSample(): Promise<DiagramData> {
  const api = (window as { electronAPI?: { devLoadSample?: () => Promise<{ success: boolean; content?: string }> } }).electronAPI
  if (api?.devLoadSample) {
    try {
      const res = await api.devLoadSample()
      if (res.success && res.content) {
        const parsed = JSON.parse(res.content) as { nodes?: unknown }
        if (parsed.nodes) return parsed as DiagramData
      }
    } catch { /* fall through */ }
  }
  return buildFintechSampleRaw()
}

/**
 * Synchronous build — hardcoded initial positions, no smart layout.
 * Used as a fallback when no saved layout is present in fintechSampleData.json.
 */
export function buildFintechSampleRaw(): DiagramData {
  if ((savedSampleData as { nodes?: unknown }).nodes) {
    const data = JSON.parse(JSON.stringify(savedSampleData)) as DiagramData
    if (!data.metamodel) data.metamodel = builtInGovernanceMetamodel()
    return data
  }

  const { allNodes, allRels } = _makeBaseData()

  const nodeMap: Record<string, C4Node> = {}
  for (const n of allNodes) nodeMap[n.id] = { ...n }
  const mainPositions = recordToPos(nodeMap)

  // Milestones — use main positions (no independent layout in raw mode)
  const v1nodes: Record<string, C4Node> = {}
  const v1rels: Record<string, C4Relation> = {}
  for (const id of V1_NODES) { if (nodeMap[id]) v1nodes[id] = { ...nodeMap[id] } }
  for (const id of V1_RELS)  { const r = allRels.find(r => r.id === id); if (r) v1rels[r.id] = r }

  const v2nodes: Record<string, C4Node> = {}
  const v2rels: Record<string, C4Relation> = {}
  for (const id of V2_NODES) { if (nodeMap[id]) v2nodes[id] = { ...nodeMap[id] } }
  for (const id of V2_RELS)  { const r = allRels.find(r => r.id === id); if (r) v2rels[r.id] = r }

  const v3nodes: Record<string, C4Node> = {}
  const v3rels: Record<string, C4Relation> = {}
  for (const n of allNodes) v3nodes[n.id] = { ...n }
  for (const r of allRels)  v3rels[r.id] = r

  const snapshots: DiagramSnapshot[] = [
    { id: 'snap-v1', name: 'v1 – Core & Accounts',   timestamp: Date.now() - 90 * 86400000, nodes: v1nodes, relations: v1rels },
    { id: 'snap-v2', name: 'v2 – Payments & Events', timestamp: Date.now() - 45 * 86400000, nodes: v2nodes, relations: v2rels },
    { id: 'snap-v3', name: 'v3 – Full Platform',     timestamp: Date.now(),                 nodes: v3nodes, relations: v3rels },
  ]

  const views: DiagramView[] = [
    { id: 'view-ctx',      name: 'System Context',     kind: 'static',  nodeIds: CTX_IDS,      positions: mainPositions, viewport: { x: 300, y: 60, zoom: 0.55 } },
    { id: 'view-core',     name: 'Core Banking',        kind: 'static',  nodeIds: CORE_IDS,     positions: mainPositions, viewport: { x: 60,  y: 40, zoom: 0.45 } },
    { id: 'view-payments', name: 'Payments Domain',     kind: 'static',  nodeIds: PAY_IDS,      positions: mainPositions, viewport: { x: 100, y: 60, zoom: 0.55 } },
    { id: 'view-payflow',  name: 'Payment Flow',        kind: 'dynamic', nodeIds: PAYFLOW_IDS,  positions: mainPositions, viewport: { x: 100, y: 60, zoom: 0.55 }, sequenceId: 'seq-payment-flow' },
    { id: 'view-treemap',  name: 'Platform Hierarchy',  kind: 'treemap', nodeIds: TREEMAP_IDS,  positions: mainPositions, viewport: { x: 80,  y: 80, zoom: 0.6  } },
    { id: 'view-matrix',   name: 'Dependency Matrix',   kind: 'matrix',  nodeIds: MATRIX_IDS,   positions: mainPositions, viewport: { x: 0,   y: 0,  zoom: 1    } },
    { id: 'view-governance', name: 'Governance',        kind: 'table',   nodeIds: GOVERNANCE_IDS, positions: mainPositions, viewport: { x: 0, y: 0, zoom: 1 } },
    { id: 'view-wiki',     name: 'Architecture Wiki',   kind: 'wiki',    nodeIds: CORE_IDS,     positions: mainPositions, viewport: { x: 0,   y: 0,  zoom: 1    } },
  ]

  return {
    nodes: allNodes,
    relations: allRels,
    sequences: _buildSequences(),
    views,
    snapshots,
    presentations: _buildPresentations(),
    defaultPositions: mainPositions,
    metamodel: builtInGovernanceMetamodel(),
  }
}

export async function buildFintechSample(): Promise<DiagramData> {

  // ── If a pre-computed layout is bundled, use it directly ──────────────────
  if ((savedSampleData as { nodes?: unknown }).nodes) {
    const data = JSON.parse(JSON.stringify(savedSampleData)) as DiagramData
    if (!data.metamodel) data.metamodel = builtInGovernanceMetamodel()
    return data
  }

  // ── Otherwise build programmatically + apply smart layout ─────────────────

  const { allNodes, allRels } = _makeBaseData()

  const nodeMap: Record<string, C4Node> = {}
  const relMap: Record<string, C4Relation> = {}
  for (const n of allNodes) nodeMap[n.id] = { ...n }
  for (const r of allRels)  relMap[r.id]  = { ...r }

  // Main layout (all nodes)
  await applyLayoutInPlace(nodeMap, relMap)
  const mainPositions = recordToPos(nodeMap)

  // ── Milestones (each gets its own independent layout) ─────────────────────

  const v1nodes: Record<string, C4Node> = {}
  const v1rels: Record<string, C4Relation> = {}
  for (const id of V1_NODES) { if (nodeMap[id]) v1nodes[id] = { ...nodeMap[id] } }
  for (const id of V1_RELS)  { const r = allRels.find(r => r.id === id); if (r) v1rels[r.id] = r }
  await applyLayoutInPlace(v1nodes, v1rels)

  const v2nodes: Record<string, C4Node> = {}
  const v2rels: Record<string, C4Relation> = {}
  for (const id of V2_NODES) { if (nodeMap[id]) v2nodes[id] = { ...nodeMap[id] } }
  for (const id of V2_RELS)  { const r = allRels.find(r => r.id === id); if (r) v2rels[r.id] = r }
  await applyLayoutInPlace(v2nodes, v2rels)

  const v3nodes: Record<string, C4Node> = {}
  const v3rels: Record<string, C4Relation> = {}
  for (const n of allNodes) v3nodes[n.id] = { ...n }
  for (const r of allRels)  v3rels[r.id]  = { ...r }
  await applyLayoutInPlace(v3nodes, v3rels)

  const snapshots: DiagramSnapshot[] = [
    { id: 'snap-v1', name: 'v1 – Core & Accounts',   timestamp: Date.now() - 90 * 86400000, nodes: v1nodes, relations: v1rels },
    { id: 'snap-v2', name: 'v2 – Payments & Events', timestamp: Date.now() - 45 * 86400000, nodes: v2nodes, relations: v2rels },
    { id: 'snap-v3', name: 'v3 – Full Platform',     timestamp: Date.now(),                 nodes: v3nodes, relations: v3rels },
  ]

  // ── Views (each gets its own layout) ──────────────────────────────────────

  const ctxNodes = buildViewSubset(CTX_IDS, nodeMap)
  const ctxRels  = buildRelSubset(ctxNodes, allRels)
  await applyLayoutInPlace(ctxNodes, ctxRels)
  const ctxPositions: Record<string, NodePosition> = { ...mainPositions, ...recordToPos(ctxNodes) }

  const coreNodes = buildViewSubset(CORE_IDS, nodeMap)
  const coreRels  = buildRelSubset(coreNodes, allRels)
  await applyLayoutInPlace(coreNodes, coreRels)
  const corePositions: Record<string, NodePosition> = { ...mainPositions, ...recordToPos(coreNodes) }

  const payNodes = buildViewSubset(PAY_IDS, nodeMap)
  const payRels  = buildRelSubset(payNodes, allRels)
  await applyLayoutInPlace(payNodes, payRels)
  const payPositions: Record<string, NodePosition> = { ...mainPositions, ...recordToPos(payNodes) }

  const payflowNodes = buildViewSubset(PAYFLOW_IDS, nodeMap)
  const payflowRels  = buildRelSubset(payflowNodes, allRels)
  await applyLayoutInPlace(payflowNodes, payflowRels)
  const payflowPositions: Record<string, NodePosition> = { ...mainPositions, ...recordToPos(payflowNodes) }

  const views: DiagramView[] = [
    { id: 'view-ctx',      name: 'System Context',    kind: 'static',  nodeIds: CTX_IDS,      positions: ctxPositions,     viewport: { x: 300, y: 60, zoom: 0.55 } },
    { id: 'view-core',     name: 'Core Banking',       kind: 'static',  nodeIds: CORE_IDS,     positions: corePositions,    viewport: { x: 60,  y: 40, zoom: 0.45 } },
    { id: 'view-payments', name: 'Payments Domain',    kind: 'static',  nodeIds: PAY_IDS,      positions: payPositions,     viewport: { x: 100, y: 60, zoom: 0.55 } },
    { id: 'view-payflow',  name: 'Payment Flow',       kind: 'dynamic', nodeIds: PAYFLOW_IDS,  positions: payflowPositions, viewport: { x: 100, y: 60, zoom: 0.55 }, sequenceId: 'seq-payment-flow' },
    { id: 'view-treemap',  name: 'Platform Hierarchy', kind: 'treemap', nodeIds: TREEMAP_IDS,  positions: mainPositions,    viewport: { x: 80,  y: 80, zoom: 0.6  } },
    { id: 'view-matrix',   name: 'Dependency Matrix',  kind: 'matrix',  nodeIds: MATRIX_IDS,   positions: mainPositions,    viewport: { x: 0,   y: 0,  zoom: 1    } },
    { id: 'view-governance', name: 'Governance',       kind: 'table',   nodeIds: GOVERNANCE_IDS, positions: mainPositions,  viewport: { x: 0, y: 0, zoom: 1 } },
    { id: 'view-wiki',     name: 'Architecture Wiki',  kind: 'wiki',    nodeIds: CORE_IDS,     positions: mainPositions,    viewport: { x: 0,   y: 0,  zoom: 1    } },
  ]

  return {
    nodes: Object.values(nodeMap),
    relations: allRels,
    sequences: _buildSequences(),
    views,
    snapshots,
    presentations: _buildPresentations(),
    defaultPositions: mainPositions,
    metamodel: builtInGovernanceMetamodel(),
  }
}
