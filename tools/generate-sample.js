#!/usr/bin/env node
/**
 * Generates src/renderer/src/store/fintechSampleData.json with ELK-computed
 * layout positions for every view and milestone in the sample model.
 *
 * Run from the repo root:
 *   node tools/generate-sample.js
 */
'use strict'

const ELK = require('elkjs/lib/elk.bundled.js')
const { writeFileSync } = require('fs')
const { resolve } = require('path')

const elk = new ELK()

// ── Constants (mirror c4.ts) ──────────────────────────────────────────────────

const COLLAPSED_WIDTH  = { person: 150, system: 280, container: 240, component: 200, database: 190, webapp: 210, queue: 220, domain: 360 }
const COLLAPSED_HEIGHT = { person: 170, system: 180, container: 160, component: 120, database: 130, webapp: 140, queue: 95,  domain: 220 }

// ── ELK layout options (mirror elkLayout.ts) ──────────────────────────────────

const LAYERED_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '80',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.thoroughness': '50',
  'elk.layered.considerModelOrder.strategy': 'NONE',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.spacing.nodeNode': '60',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.edgeNode': '20',
  'elk.spacing.edgeEdge': '10',
  'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.padding': '[top=120, right=30, bottom=30, left=30]',
}

const CHILD_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '40',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
  'elk.layered.thoroughness': '50',
  'elk.layered.considerModelOrder.strategy': 'NONE',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.spacing.nodeNode': '30',
  'elk.layered.spacing.nodeNodeBetweenLayers': '50',
  'elk.spacing.edgeNode': '12',
  'elk.spacing.edgeEdge': '8',
  'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.padding': '[top=110, right=20, bottom=20, left=20]',
}

// ── ELK helpers (mirror elkLayout.ts) ─────────────────────────────────────────

function ancestorChain(nodeId, nodes) {
  const chain = [nodeId]
  let cur = nodes[nodeId]
  while (cur && cur.parentId) {
    chain.push(cur.parentId)
    cur = nodes[cur.parentId]
  }
  return chain
}

function lcaContainerId(srcId, tgtId, nodes) {
  if (srcId === tgtId) return nodes[srcId] && nodes[srcId].parentId
  const srcSet = new Set(ancestorChain(srcId, nodes))
  for (const id of ancestorChain(tgtId, nodes)) {
    if (srcSet.has(id) && id !== srcId && id !== tgtId) return id
  }
  return undefined
}

function buildElkNode(n, allNodes, elkNodeMap) {
  const isCollapsed = n.collapsed && (n.type === 'system' || n.type === 'container' || n.type === 'domain')
  const width  = isCollapsed ? (COLLAPSED_WIDTH[n.type]  || n.width)  : n.width
  const height = isCollapsed ? (COLLAPSED_HEIGHT[n.type] || n.height) : n.height
  const childC4 = isCollapsed ? [] : Object.values(allNodes).filter(c => c.parentId === n.id)
  const children = childC4.map(c => buildElkNode(c, allNodes, elkNodeMap))

  const elkNode = {
    id: n.id,
    width,
    height,
    layoutOptions: children.length > 0 ? CHILD_OPTIONS : undefined,
    children,
    edges: [],
  }
  elkNodeMap[n.id] = elkNode
  return elkNode
}

function parseElkResult(node, result) {
  if (node.id !== 'root' && node.x != null && node.y != null) {
    result[node.id] = { x: node.x, y: node.y, width: node.width || 0, height: node.height || 0 }
  }
  for (const child of node.children || []) {
    parseElkResult(child, result)
  }
}

async function applyElkLayout(nodeMap, relList) {
  const elkNodeMap = {}
  const rootChildren = Object.values(nodeMap)
    .filter(n => !n.parentId)
    .map(n => buildElkNode(n, nodeMap, elkNodeMap))

  const root = {
    id: 'root',
    layoutOptions: LAYERED_OPTIONS,
    children: rootChildren,
    edges: [],
  }
  elkNodeMap['root'] = root

  for (const rel of relList) {
    if (!nodeMap[rel.sourceId] || !nodeMap[rel.targetId]) continue
    const lca = lcaContainerId(rel.sourceId, rel.targetId, nodeMap)
    const container = (lca ? elkNodeMap[lca] : root) || root
    if (!container.edges) container.edges = []
    container.edges.push({ id: rel.id, sources: [rel.sourceId], targets: [rel.targetId] })
  }

  try {
    const result = await elk.layout(root)
    const positions = {}
    parseElkResult(result, positions)
    return positions
  } catch (err) {
    console.error('[ELK] Layout error:', err.message)
    return {}
  }
}

// ── Model helpers ─────────────────────────────────────────────────────────────

function nd(id, type, label, description, technology, x, y, w, h, opts) {
  return Object.assign({ id, type, label, description, technology, x, y, width: w, height: h, collapsed: false }, opts || {})
}

function rl(id, src, tgt, label, tech) {
  return { id, sourceId: src, targetId: tgt, label, technology: tech || '' }
}

/** Governance relation with an explicit metamodel relationType. */
function gr(id, src, tgt, relationType, label) {
  return { id, sourceId: src, targetId: tgt, relationType, label: label || '', technology: '' }
}

function buildViewSubset(viewNodeIds, allNodeMap) {
  const result = {}
  for (const id of viewNodeIds) {
    const n = allNodeMap[id]
    if (!n) continue
    const hasChildrenInModel = Object.values(allNodeMap).some(c => c.parentId === id)
    const hasChildrenInView  = viewNodeIds.some(vid => allNodeMap[vid] && allNodeMap[vid].parentId === id)
    const isViewCollapsed = hasChildrenInModel && !hasChildrenInView &&
                            (n.type === 'system' || n.type === 'container')
    result[id] = isViewCollapsed
      ? Object.assign({}, n, { width: COLLAPSED_WIDTH[n.type] || n.width, height: COLLAPSED_HEIGHT[n.type] || n.height })
      : Object.assign({}, n)
  }
  return result
}

function buildRelSubset(nodeMap, allRels) {
  const nodeSet = new Set(Object.keys(nodeMap))
  const result = {}
  for (const r of allRels) {
    if (nodeSet.has(r.sourceId) && nodeSet.has(r.targetId)) result[r.id] = r
  }
  return result
}

function applyPositions(nodeMap, positions) {
  for (const [id, pos] of Object.entries(positions)) {
    const node = nodeMap[id]
    if (!node) continue
    node.x = pos.x
    node.y = pos.y
    node.width  = pos.width
    node.height = pos.height
  }
}

function recordToPos(nodeMap) {
  const out = {}
  for (const n of Object.values(nodeMap)) {
    out[n.id] = { x: n.x, y: n.y, width: n.width, height: n.height }
  }
  return out
}

/** Compute a reasonable viewport for a set of root-level nodes. */
function computeViewport(nodeMap, zoom) {
  zoom = zoom || 0.55
  const roots = Object.values(nodeMap).filter(n => !n.parentId)
  if (roots.length === 0) return { x: 80, y: 80, zoom }
  let minX = Infinity, minY = Infinity
  for (const n of roots) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
  }
  return { x: Math.round(-minX * zoom + 80), y: Math.round(-minY * zoom + 80), zoom }
}

// ── Sample model definition (mirrors fintechSample.ts _makeBaseData) ──────────

function makeBaseData() {
  const allNodes = [
    // Actors
    nd('p-customer', 'person', 'Retail Customer',  'Individual banking customer accessing via web and mobile', '', -250, 200,  150, 170),
    nd('p-corp',     'person', 'Corporate Client', 'Business client using treasury and bulk-payment APIs',     '', -250, 440,  150, 170),
    nd('p-ops',      'person', 'Bank Operator',    'Internal staff managing operations and support',           '', -250, 670,  150, 170),

    // Core Banking Platform (system → 3 domains)
    nd('sys-core', 'system', 'Core Banking Platform',
      'Central microservices platform — all banking domain logic', 'Kubernetes / Istio',
      50, 0, 2200, 980),

    // Domain: Access & Security
    nd('dom-access', 'domain', 'Access & Security',
      'API gateway, authentication and authorisation for all inbound traffic', 'Kong / Keycloak',
      60, 100, 700, 360, { parentId: 'sys-core' }),
    nd('ctn-apigw', 'container', 'API Gateway',
      'Routes all external traffic, enforces rate limits and TLS termination', 'Kong / Nginx',
      30, 110, 300, 200, { parentId: 'dom-access' }),
    nd('ctn-auth', 'container', 'Auth Service',
      'Issues JWT tokens and validates OIDC sessions', 'Keycloak / OAuth 2.0',
      370, 110, 300, 200, { parentId: 'dom-access' }),

    // Domain: Banking Services
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

    // Domain: Risk & Data
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

    // Digital Channels (system → 2 webapps)
    nd('sys-channels', 'system', 'Digital Channels',
      'Customer-facing web portal and native mobile app', 'React / React Native',
      2360, 80, 270, 450),
    nd('ctn-web', 'webapp', 'Web Banking',
      'Full-featured banking portal for browsers', 'React 18 / TypeScript',
      30, 100, 210, 140, { parentId: 'sys-channels' }),
    nd('ctn-mobile', 'webapp', 'Mobile App',
      'Native banking app for iOS and Android', 'React Native / Expo',
      30, 300, 210, 140, { parentId: 'sys-channels' }),

    // External systems
    nd('sys-swift', 'system', 'SWIFT Network',      'International wire transfer messaging',   'SWIFT MT / ISO 20022', 200,  1060, 360, 260, { external: true }),
    nd('sys-cards', 'system', 'Card Networks',       'Visa / Mastercard authorisation',         'ISO 8583 / Visa API',  620,  1060, 360, 260, { external: true }),
    nd('sys-kyc',   'system', 'KYC / AML Provider', 'Identity verification and AML screening', 'REST / JSON',          1040, 1060, 360, 260, { external: true }),

    // ── Governance: Architecture Decision Records (Nygard / MADR) ─────────────
    nd('adr-evt', 'adr', 'ADR-001: Event-Driven Core', '', '', 2700, 0, 180, 52, {
      status: 'accepted', date: '2024-02-12',
      context: 'Synchronous service-to-service calls were creating tight coupling and cascading failures between payments, accounts and fraud.',
      decision: 'Introduce an Apache Kafka event bus and move all cross-domain communication to asynchronous domain events.',
      consequences: 'Looser coupling and independent scaling, at the cost of eventual consistency and the need for idempotent consumers.',
      alternatives: 'Synchronous gRPC mesh; shared database integration.',
    }),
    nd('adr-ledger', 'adr', 'ADR-002: Immutable Ledger on PostgreSQL', '', '', 2700, 90, 180, 52, {
      status: 'accepted', date: '2024-03-04',
      context: 'Financial transactions must be auditable and tamper-evident for regulators.',
      decision: 'Store transactions in an append-only PostgreSQL ledger with Patroni replication; never update or delete rows.',
      consequences: 'Strong auditability and point-in-time reconstruction; table growth requires partitioning and archival.',
      alternatives: 'Mutable balance table; event-store-only persistence.',
    }),
    nd('adr-jwt', 'adr', 'ADR-003: Stateless JWT Auth', '', '', 2700, 180, 180, 52, {
      status: 'accepted', date: '2024-01-20',
      context: 'Session affinity made horizontal scaling of the API tier difficult.',
      decision: 'Use short-lived signed JWT access tokens issued by Keycloak; validate at the gateway with no server-side session store.',
      consequences: 'Stateless, horizontally scalable auth; token revocation needs a short TTL plus a denylist.',
      alternatives: 'Server-side sessions in Redis; opaque tokens with introspection.',
    }),
    nd('adr-mono', 'adr', 'ADR-000: Modular Monolith', '', '', 2700, 270, 180, 52, {
      status: 'superseded', date: '2023-09-01',
      context: 'The initial MVP needed to ship quickly with a small team.',
      decision: 'Build the platform as a single modular monolith deployed as one unit.',
      consequences: 'Fast early delivery, but scaling and team autonomy became bottlenecks as the platform grew.',
      alternatives: 'Microservices from day one.',
    }),

    // ── Governance: Fitness Functions (Building Evolutionary Architectures) ───
    nd('ff-latency', 'fitness-fn', 'FF: Payment p99 < 250ms',
      'Continuously asserts that the end-to-end payment path stays within its latency budget.', '', 2900, 0, 180, 52, {
      category: 'operational', automated: true, trigger: 'continuous', status: 'active',
      threshold: 'p99 latency < 250ms measured over any rolling 24h window',
    }),
    nd('ff-ledger', 'fitness-fn', 'FF: Zero ledger data loss',
      'Verifies the transaction ledger survives node failure with no committed-record loss.', '', 2900, 90, 180, 52, {
      category: 'structural', automated: true, trigger: 'on-deploy', status: 'active',
      threshold: 'No committed transaction lost during automated chaos / failover tests',
    }),
  ]

  const allRels = [
    rl('r-cust-web',    'p-customer',   'ctn-web',      'Views accounts & transfers',  'HTTPS / Browser'),
    rl('r-corp-web',    'p-corp',       'ctn-web',      'Bulk payments & treasury',    'HTTPS / Browser'),
    rl('r-ops-apigw',   'p-ops',        'ctn-apigw',    'Admin & support operations',  'HTTPS / Admin API'),
    rl('r-web-apigw',   'ctn-web',      'ctn-apigw',    'API calls', 'HTTPS / REST'),
    rl('r-mob-apigw',   'ctn-mobile',   'ctn-apigw',    'API calls', 'HTTPS / REST'),
    rl('r-apigw-auth',  'ctn-apigw',    'ctn-auth',     'Validates token',  'JWT / OIDC'),
    rl('r-apigw-pay',   'ctn-apigw',    'ctn-payments', 'Routes',           'HTTP/2 / gRPC'),
    rl('r-apigw-acc',   'ctn-apigw',    'ctn-accounts', 'Routes',           'HTTP/2 / gRPC'),
    rl('r-pay-dbtx',    'ctn-payments', 'ctn-db-tx',    'Reads / writes', 'JDBC / SQL'),
    rl('r-acc-dbacc',   'ctn-accounts', 'ctn-db-acc',   'Reads / writes', 'JDBC / SQL'),
    rl('r-pay-evtbus',  'ctn-payments', 'ctn-evtbus',   'Publishes payment.completed', 'Kafka producer'),
    rl('r-acc-evtbus',  'ctn-accounts', 'ctn-evtbus',   'Publishes balance.updated',   'Kafka producer'),
    rl('r-evtbus-fraud','ctn-evtbus',   'ctn-fraud',    'Consumes all tx events',      'Kafka consumer'),
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

// ── View node ID lists ─────────────────────────────────────────────────────────

const CTX_IDS = ['p-customer', 'p-corp', 'p-ops', 'sys-core', 'sys-channels', 'sys-swift', 'sys-cards', 'sys-kyc']

const CORE_IDS = [
  'sys-core',
  'dom-access', 'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk', 'ctn-fraud', 'ctn-db-acc', 'ctn-db-tx',
]

const PAY_IDS = [
  'p-customer',
  'sys-channels', 'ctn-web',
  'sys-core',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk', 'ctn-fraud', 'ctn-db-tx',
  'sys-swift', 'sys-cards',
]

const PAYFLOW_IDS = [
  'p-customer',
  'sys-channels', 'ctn-web',
  'sys-core',
  'dom-access', 'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-evtbus',
  'dom-risk', 'ctn-fraud',
  'sys-swift',
]

const TREEMAP_IDS = [
  'sys-core',
  'dom-access', 'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk', 'ctn-fraud', 'ctn-db-acc', 'ctn-db-tx',
  'sys-channels', 'ctn-web', 'ctn-mobile',
]

// Matrix (DSM): the concrete services/stores that exchange traffic
const MATRIX_IDS = [
  'ctn-web', 'ctn-mobile', 'ctn-apigw', 'ctn-auth',
  'ctn-payments', 'ctn-accounts', 'ctn-evtbus', 'ctn-fraud',
  'ctn-db-acc', 'ctn-db-tx',
]

// Governance table: architecture + decisions + fitness functions together
const GOVERNANCE_IDS = [
  'sys-core',
  'dom-access', 'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-accounts', 'ctn-evtbus',
  'dom-risk', 'ctn-fraud', 'ctn-db-acc', 'ctn-db-tx',
  'adr-evt', 'adr-ledger', 'adr-jwt', 'adr-mono',
  'ff-latency', 'ff-ledger',
]

const V1_NODES = [
  'p-customer', 'sys-channels', 'ctn-web',
  'sys-core', 'dom-access', 'ctn-apigw', 'ctn-auth',
  'dom-banking', 'ctn-accounts',
  'dom-risk', 'ctn-db-acc',
]
const V1_RELS = ['r-cust-web', 'r-web-apigw', 'r-apigw-auth', 'r-apigw-acc', 'r-acc-dbacc']

const V2_NODES = [
  ...V1_NODES,
  'ctn-payments', 'comp-validator', 'comp-fx', 'ctn-evtbus', 'ctn-db-tx', 'sys-swift',
]
const V2_RELS = [
  ...V1_RELS,
  'r-apigw-pay', 'r-pay-dbtx', 'r-pay-evtbus', 'r-acc-evtbus', 'r-pay-swift',
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { allNodes, allRels } = makeBaseData()

  // Build nodeMap and relMap for main model
  const allNodeMap = {}
  const allRelMap = {}
  for (const n of allNodes) allNodeMap[n.id] = Object.assign({}, n)
  for (const r of allRels)  allRelMap[r.id]  = Object.assign({}, r)

  // 1. Main layout (all nodes)
  console.log('Computing main layout...')
  const mainPos = await applyElkLayout(allNodeMap, allRels)
  applyPositions(allNodeMap, mainPos)
  const defaultPositions = recordToPos(allNodeMap)

  // 2. Context view
  console.log('Computing context view layout...')
  const ctxNodes = buildViewSubset(CTX_IDS, allNodeMap)
  const ctxRels  = Object.values(buildRelSubset(ctxNodes, allRels))
  const ctxPos   = await applyElkLayout(ctxNodes, ctxRels)
  applyPositions(ctxNodes, ctxPos)
  const ctxPositions = Object.assign({}, defaultPositions, recordToPos(ctxNodes))

  // 3. Core banking view
  console.log('Computing core banking view layout...')
  const coreNodes = buildViewSubset(CORE_IDS, allNodeMap)
  const coreRels  = Object.values(buildRelSubset(coreNodes, allRels))
  const corePos   = await applyElkLayout(coreNodes, coreRels)
  applyPositions(coreNodes, corePos)
  const corePositions = Object.assign({}, defaultPositions, recordToPos(coreNodes))

  // 4. Payments domain view
  console.log('Computing payments domain view layout...')
  const payNodes = buildViewSubset(PAY_IDS, allNodeMap)
  const payRels  = Object.values(buildRelSubset(payNodes, allRels))
  const payPos   = await applyElkLayout(payNodes, payRels)
  applyPositions(payNodes, payPos)
  const payPositions = Object.assign({}, defaultPositions, recordToPos(payNodes))

  // 5. Payment flow view (dynamic)
  console.log('Computing payment flow view layout...')
  const payflowNodes = buildViewSubset(PAYFLOW_IDS, allNodeMap)
  const payflowRels  = Object.values(buildRelSubset(payflowNodes, allRels))
  const payflowPos   = await applyElkLayout(payflowNodes, payflowRels)
  applyPositions(payflowNodes, payflowPos)
  const payflowPositions = Object.assign({}, defaultPositions, recordToPos(payflowNodes))

  // 6. Treemap view — no layout needed (renderer computes it)
  const treemapPositions = Object.assign({}, defaultPositions)

  // 7. Milestone v1
  console.log('Computing v1 milestone layout...')
  const v1NodeMap = {}
  for (const id of V1_NODES) { if (allNodeMap[id]) v1NodeMap[id] = Object.assign({}, allNodeMap[id]) }
  const v1RelList = allRels.filter(r => V1_RELS.includes(r.id))
  const v1Pos = await applyElkLayout(v1NodeMap, v1RelList)
  applyPositions(v1NodeMap, v1Pos)

  // 8. Milestone v2
  console.log('Computing v2 milestone layout...')
  const v2NodeMap = {}
  for (const id of V2_NODES) { if (allNodeMap[id]) v2NodeMap[id] = Object.assign({}, allNodeMap[id]) }
  const v2RelList = allRels.filter(r => V2_RELS.includes(r.id))
  const v2Pos = await applyElkLayout(v2NodeMap, v2RelList)
  applyPositions(v2NodeMap, v2Pos)

  // 9. Milestone v3 (full model) uses the main layout positions
  const v3NodeMap = {}
  for (const n of Object.values(allNodeMap)) v3NodeMap[n.id] = Object.assign({}, n)

  // Compute viewports
  const ctxVp     = computeViewport(ctxNodes, 0.55)
  const coreVp    = computeViewport(coreNodes, 0.45)
  const payVp     = computeViewport(payNodes, 0.55)
  const payflowVp = computeViewport(payflowNodes, 0.55)
  const treemapVp = { x: 80, y: 80, zoom: 0.6 }
  const mainVp    = computeViewport(allNodeMap, 0.4)
  const v1Vp      = computeViewport(v1NodeMap, 0.6)

  const data = {
    nodes: Object.values(allNodeMap),
    relations: allRels,
    sequences: [{
      id: 'seq-payment-flow',
      name: 'Payment Processing',
      relationIds: ['r-cust-web', 'r-web-apigw', 'r-apigw-auth', 'r-apigw-pay', 'r-pay-evtbus', 'r-evtbus-fraud', 'r-pay-swift'],
      stepDescriptions: [
        'Customer initiates transfer',
        'Web app calls REST API',
        'Gateway validates JWT token',
        'Routes to Payments Service',
        'Publishes payment.completed event',
        'Fraud Detection scores transaction',
        'Sends wire via SWIFT',
      ],
    }],
    views: [
      { id: 'view-ctx',      name: 'System Context',    kind: 'static',  nodeIds: CTX_IDS,     positions: ctxPositions,     viewport: ctxVp     },
      { id: 'view-core',     name: 'Core Banking',       kind: 'static',  nodeIds: CORE_IDS,    positions: corePositions,    viewport: coreVp    },
      { id: 'view-payments', name: 'Payments Domain',    kind: 'static',  nodeIds: PAY_IDS,     positions: payPositions,     viewport: payVp     },
      { id: 'view-payflow',  name: 'Payment Flow',       kind: 'dynamic', nodeIds: PAYFLOW_IDS, positions: payflowPositions, viewport: payflowVp, sequenceId: 'seq-payment-flow' },
      { id: 'view-treemap',  name: 'Platform Hierarchy', kind: 'treemap', nodeIds: TREEMAP_IDS, positions: treemapPositions, viewport: treemapVp },
      { id: 'view-matrix',   name: 'Dependency Matrix', kind: 'matrix', nodeIds: MATRIX_IDS, positions: defaultPositions, viewport: { x: 0, y: 0, zoom: 1 } },
      { id: 'view-governance', name: 'Governance', kind: 'table', nodeIds: GOVERNANCE_IDS, positions: defaultPositions, viewport: { x: 0, y: 0, zoom: 1 } },
    ],
    snapshots: [
      { id: 'snap-v1', name: 'v1 – Core & Accounts',   timestamp: Date.now() - 90 * 86400000, nodes: v1NodeMap, relations: Object.fromEntries(v1RelList.map(r => [r.id, r])) },
      { id: 'snap-v2', name: 'v2 – Payments & Events', timestamp: Date.now() - 45 * 86400000, nodes: v2NodeMap, relations: Object.fromEntries(v2RelList.map(r => [r.id, r])) },
      { id: 'snap-v3', name: 'v3 – Full Platform',     timestamp: Date.now(),                 nodes: v3NodeMap, relations: allRelMap },
    ],
    presentations: [{
      id: 'pres-walkthrough',
      name: 'Architecture Walkthrough',
      slides: [
        { id: 'slide-ctx',      name: '1 – System Context',     snapshotId: null,      viewId: 'view-ctx',      viewport: ctxVp     },
        { id: 'slide-core',     name: '2 – Core Banking',        snapshotId: null,      viewId: 'view-core',     viewport: coreVp    },
        { id: 'slide-payments', name: '3 – Payments Domain',     snapshotId: null,      viewId: 'view-payments', viewport: payVp     },
        { id: 'slide-payflow',  name: '4 – Payment Flow',        snapshotId: null,      viewId: 'view-payflow',  viewport: payflowVp },
        { id: 'slide-treemap',  name: '5 – Platform Hierarchy',  snapshotId: null,      viewId: 'view-treemap',  viewport: treemapVp },
        { id: 'slide-matrix',   name: '6 – Dependency Matrix',   snapshotId: null,      viewId: 'view-matrix',     viewport: { x: 0, y: 0, zoom: 1 } },
        { id: 'slide-governance', name: '7 – Governance',        snapshotId: null,      viewId: 'view-governance', viewport: { x: 0, y: 0, zoom: 1 } },
        { id: 'slide-v1',       name: '8 – v1 MVP (Milestone)',  snapshotId: 'snap-v1', viewId: null,            viewport: v1Vp      },
      ],
    }],
    defaultPositions,
    defaultViewport: mainVp,
  }

  const outPath = resolve(__dirname, '../src/renderer/src/store/fintechSampleData.json')
  writeFileSync(outPath, JSON.stringify(data, null, 2))
  console.log(`✓ Written to ${outPath}`)
  console.log(`  Nodes: ${data.nodes.length} | Relations: ${data.relations.length}`)
  console.log(`  Views: ${data.views.length} | Snapshots: ${data.snapshots.length}`)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
