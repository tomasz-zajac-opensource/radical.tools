/**
 * Fintech Banking Platform — a rich sample C4 model demonstrating:
 *  - A multi-container banking system (8 services + 3 infra nodes)
 *  - External actors and systems
 *  - 4 milestones tracking the platform evolution
 *  - 3 named views (System Context, Containers, Payments Domain)
 *  - 1 presentation with 5 slides
 */

import type {
  DiagramData, C4Node, C4Relation, DiagramSnapshot, DiagramView, NodePosition, Presentation,
} from '../types/c4'
import { COLLAPSED_HEIGHT, COLLAPSED_WIDTH } from '../types/c4'
import { runSmartLayout } from '../layout/smartLayout'
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

function pick(
  allNodes: C4Node[], allRels: C4Relation[],
  nodeIds: string[], relIds: string[],
): { nodes: Record<string, C4Node>; relations: Record<string, C4Relation> } {
  const nodes: Record<string, C4Node> = {}
  const relations: Record<string, C4Relation> = {}
  for (const n of allNodes) {
    if (nodeIds.includes(n.id)) nodes[n.id] = { ...n }
  }
  for (const r of allRels) {
    if (relIds.includes(r.id)) relations[r.id] = r
  }
  return { nodes, relations }
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

// ── Dimensions (matching NODE_SIZES in c4.ts) ─────────────────────────────────

const CW = 280; const CH = 180   // container
const DBW = 200; const DBH = 120 // database
const QW = 240; const QH = 90   // queue
const WAW = 220; const WAH = 140 // webapp
const PW = 130; const PH = 140  // person

// Subsystem sizes — each is a system inside sys-core
//   sub-access:   2 containers (API GW + Auth)           ≈ 640 × 280
//   sub-banking:  3 containers (Accounts + Payments + Cards) ≈ 960 × 280
//   sub-risk:     2 containers (Fraud + Reporting)        ≈ 640 × 280
//   sub-platform: 2 queues/infra + 3 DBs across 2 rows   ≈ 960 × 440
const SUB_ACCESS_W  = 640;  const SUB_ACCESS_H  = 280
const SUB_BANKING_W = 960;  const SUB_BANKING_H = 280
const SUB_RISK_W    = 640;  const SUB_RISK_H    = 280
const SUB_PLAT_W    = 960;  const SUB_PLAT_H    = 340

// ── Build ─────────────────────────────────────────────────────────────────────

/** All node + relation definitions (no layout applied). */
function _makeBaseData(): { allNodes: C4Node[]; allRels: C4Relation[] } {
  const allNodes: C4Node[] = [

    // ── External actors ──
    nd('p-customer', 'person', 'Retail Customer',  'Individual banking customer accessing via web and mobile', '', -320, 80,  PW, PH),
    nd('p-corp',     'person', 'Corporate Client', 'Business customer using treasury and bulk-payment APIs',   '', -320, 330, PW, PH),
    nd('p-ops',      'person', 'Bank Operator',    'Internal staff managing operations and support tickets',   '', -320, 580, PW, PH),

    // ── Core Banking Platform ─────────────────────────────────────────────────
    // Outer system: contains 4 subsystems arranged in a 2×2 grid
    //   Left col:  sub-access (640)   + 40 gap + sub-risk (640)    = 1320
    //   Right col: sub-banking (960)  + 40 gap + sub-platform (960) = 960
    //   Total width:  max(1320, 960) with outer padding = 1420 wide
    //   Total height: row1 (280) + 40 gap + row2 (340) + top/bottom pads = 740
    nd('sys-core', 'system', 'Core Banking Platform',
      'Central microservices platform handling all banking domain logic',
      'Kubernetes / Istio', 100, 80, 2140, 800),

    // ── Subsystem: Access & Security Layer ──────────────────────────────────
    nd('sub-access', 'system', 'Access & Security',
      'API gateway, authentication and authorisation for all inbound traffic',
      'Kong / Keycloak', 40, 80, SUB_ACCESS_W, SUB_ACCESS_H, { parentId: 'sys-core' }),

    nd('ctn-api-gw', 'container', 'API Gateway',  'Routes all external traffic, enforces rate limits and TLS termination', 'Kong Gateway / Nginx',  40, 80, CW, CH, { parentId: 'sub-access' }),
    nd('ctn-auth',   'container', 'Auth Service', 'Identity & access management, issues JWT tokens via OIDC flow',         'Keycloak / OAuth 2.0', 360, 80, CW, CH, { parentId: 'sub-access' }),

    // ── Subsystem: Banking Services ──────────────────────────────────────────
    nd('sub-banking', 'system', 'Banking Services',
      'Core financial domain — accounts, payments and card management',
      'Java / Go microservices', 720, 80, SUB_BANKING_W, SUB_BANKING_H, { parentId: 'sys-core' }),

    nd('ctn-accounts', 'container', 'Accounts Service', 'Manages customer accounts, balances and statements',              'Java 21 / Spring Boot',  40,  80, CW, CH, { parentId: 'sub-banking' }),
    nd('ctn-payments', 'container', 'Payments Service', 'Processes domestic and cross-border payment instructions',        'Go 1.22 / gRPC',        360,  80, CW, CH, { parentId: 'sub-banking' }),
    nd('ctn-cards',    'container', 'Card Management',  'Issues and manages debit / credit cards, tokenisation',           'Go 1.22 / REST',        680,  80, CW, CH, { parentId: 'sub-banking' }),

    // ── Subsystem: Risk & Compliance ─────────────────────────────────────────
    nd('sub-risk', 'system', 'Risk & Compliance',
      'Real-time fraud detection, regulatory reporting and AML controls',
      'Python / Scala', 40, 440, SUB_RISK_W, SUB_RISK_H, { parentId: 'sys-core' }),

    nd('ctn-fraud',     'container', 'Fraud Detection', 'Real-time ML-based transaction risk scoring and blocking', 'Python 3.12 / XGBoost',   40, 80, CW, CH, { parentId: 'sub-risk' }),
    nd('ctn-reporting', 'container', 'Reporting Engine','Generates regulatory (PSD2, EBA) and management reports', 'Scala 3 / Apache Spark', 360, 80, CW, CH, { parentId: 'sub-risk' }),

    // ── Subsystem: Platform Infrastructure ───────────────────────────────────
    nd('sub-platform', 'system', 'Platform Infrastructure',
      'Async messaging, notifications and persistent data stores shared across all services',
      'Kafka / PostgreSQL / Redis', 720, 440, SUB_PLAT_W, SUB_PLAT_H, { parentId: 'sys-core' }),

    nd('ctn-kafka',   'queue',    'Event Bus',       'Async domain-event streaming between all microservices',            'Apache Kafka 3.6',        40,  80, QW,  QH,  { parentId: 'sub-platform' }),
    nd('ctn-notif',   'container','Notifications',   'Delivers push, SMS and e-mail alerts triggered by domain events',   'Node.js 22 / FCM / Twilio',340, 80, CW,  CH,  { parentId: 'sub-platform' }),
    nd('ctn-db-core', 'database', 'Accounts DB',     'Primary store for customer and account data',                       'PostgreSQL 15 / Patroni',  40, 240, DBW, DBH, { parentId: 'sub-platform' }),
    nd('ctn-db-tx',   'database', 'Transactions DB', 'Immutable append-only ledger of all financial transactions',        'PostgreSQL 15 / Patroni', 300, 240, DBW, DBH, { parentId: 'sub-platform' }),
    nd('ctn-redis',   'database', 'Cache / Sessions','Session tokens, rate-limit counters and hot-path account data',     'Redis 7 Cluster',         560, 240, DBW, DBH, { parentId: 'sub-platform' }),

    // ── Digital Channels ──────────────────────────────────────────────────────
    nd('sys-channels', 'system', 'Digital Channels',
      'Customer-facing web portal and native mobile applications',
      'React / Swift / Kotlin', 2320, 80, 420, 530),

    nd('ctn-web',     'webapp', 'Web Banking', 'Full-featured banking portal and admin console for browsers', 'React 18 / TypeScript',    40, 80,  WAW, WAH, { parentId: 'sys-channels' }),
    nd('ctn-ios',     'webapp', 'iOS App',     'Native banking app for iPhone and iPad',                      'Swift 5.9 / SwiftUI',      40, 280, WAW, WAH, { parentId: 'sys-channels' }),
    nd('ctn-android', 'webapp', 'Android App', 'Native banking app for Android phones and tablets',           'Kotlin / Jetpack Compose', 280, 280, WAW, WAH, { parentId: 'sys-channels' }),

    // ── External systems ──────────────────────────────────────────────────────
    nd('sys-swift', 'system', 'SWIFT Network',      'International interbank messaging for cross-border wire transfers', 'SWIFT MT / ISO 20022',  100,  960, 340, 240, { external: true }),
    nd('sys-visa',  'system', 'Card Networks',       'Visa and Mastercard payment authorisation and settlement',         'ISO 8583 / Visa API',   500,  960, 340, 240, { external: true }),
    nd('sys-kyc',   'system', 'KYC / AML Provider', 'Identity verification and anti-money-laundering screening',        'REST / JSON',           900,  960, 340, 240, { external: true }),
  ]

  // ── Relations ──────────────────────────────────────────────────────────────

  const allRels: C4Relation[] = [
    // Actors → channels
    rl('r-cust-web', 'p-customer', 'ctn-web',      'Views accounts & transfers', 'HTTPS / Browser'),
    rl('r-cust-ios', 'p-customer', 'ctn-ios',      'Mobile banking',             'TLS / Push'),
    rl('r-corp-web', 'p-corp',     'ctn-web',      'Bulk payments & treasury',   'HTTPS / Browser'),
    rl('r-ops-gw',   'p-ops',      'ctn-api-gw',   'Admin operations',           'HTTPS / Admin API'),

    // Channels → API Gateway
    rl('r-web-gw', 'ctn-web',     'ctn-api-gw', 'API calls', 'HTTPS / REST'),
    rl('r-ios-gw', 'ctn-ios',     'ctn-api-gw', 'API calls', 'HTTPS / REST'),
    rl('r-and-gw', 'ctn-android', 'ctn-api-gw', 'API calls', 'HTTPS / REST'),

    // API Gateway → services
    rl('r-gw-auth',  'ctn-api-gw', 'ctn-auth',     'Validates token',    'JWT / OIDC introspect'),
    rl('r-gw-acc',   'ctn-api-gw', 'ctn-accounts', 'Routes',             'HTTP/2 / gRPC'),
    rl('r-gw-pay',   'ctn-api-gw', 'ctn-payments', 'Routes',             'HTTP/2 / gRPC'),
    rl('r-gw-card',  'ctn-api-gw', 'ctn-cards',    'Routes',             'HTTP/2 / gRPC'),
    rl('r-gw-cache', 'ctn-api-gw', 'ctn-redis',    'Session lookup',     'Redis protocol'),

    // Services → persistence
    rl('r-acc-db',  'ctn-accounts',  'ctn-db-core', 'Reads / writes', 'JDBC / SQL'),
    rl('r-pay-db',  'ctn-payments',  'ctn-db-tx',   'Reads / writes', 'JDBC / SQL'),
    rl('r-rep-db1', 'ctn-reporting', 'ctn-db-core', 'Reads (batch)',   'JDBC / SQL'),
    rl('r-rep-db2', 'ctn-reporting', 'ctn-db-tx',   'Reads (batch)',   'JDBC / SQL'),

    // Kafka event flows
    rl('r-pay-pub',   'ctn-payments', 'ctn-kafka', 'Publishes payment.completed', 'Kafka producer'),
    rl('r-card-pub',  'ctn-cards',    'ctn-kafka', 'Publishes card.authorised',   'Kafka producer'),
    rl('r-acc-pub',   'ctn-accounts', 'ctn-kafka', 'Publishes balance.updated',   'Kafka producer'),
    rl('r-fraud-sub', 'ctn-kafka', 'ctn-fraud',    'Consumes all tx events',      'Kafka consumer'),
    rl('r-notif-sub', 'ctn-kafka', 'ctn-notif',    'Consumes domain events',      'Kafka consumer'),

    // External integrations
    rl('r-pay-swift', 'ctn-payments', 'sys-swift', 'Sends wire transfers',       'SWIFT MT103 / gpi'),
    rl('r-card-visa', 'ctn-cards',    'sys-visa',  'Card authorisation',          'ISO 8583 / Visa Direct'),
    rl('r-acc-kyc',   'ctn-accounts', 'sys-kyc',   'Identity & AML screening',   'REST / JSON'),
  ]

  return { allNodes, allRels }
}

// ── Node ID lists shared between Raw and async builders ───────────────────────

// v1 – Core & Accounts: access layer + accounts only
const V1_NODES = [
  'p-customer',
  'sys-core', 'sub-access', 'ctn-api-gw', 'ctn-auth',
  'sub-banking', 'ctn-accounts',
  'sub-platform', 'ctn-db-core',
  'sys-channels', 'ctn-web',
]
const V1_RELS  = ['r-cust-web', 'r-web-gw', 'r-gw-auth', 'r-gw-acc', 'r-acc-db']

// v2 – add Payments & Events
const V2_NODES = [...V1_NODES, 'ctn-payments', 'ctn-db-tx', 'ctn-kafka', 'sys-swift']
const V2_RELS  = [...V1_RELS, 'r-gw-pay', 'r-pay-db', 'r-pay-pub', 'r-acc-pub', 'r-pay-swift']

// v3 – add Cards & Fraud (sub-risk now appears)
const V3_NODES = [
  ...V2_NODES,
  'p-corp',
  'sub-risk', 'ctn-fraud',
  'ctn-cards', 'ctn-redis',
  'ctn-ios', 'ctn-android',
  'sys-visa',
]
const V3_RELS  = [...V2_RELS,
  'r-cust-ios', 'r-corp-web', 'r-ios-gw', 'r-and-gw',
  'r-gw-card', 'r-card-pub', 'r-gw-cache', 'r-fraud-sub', 'r-card-visa',
]

// Context view: top-level systems only (no containers visible)
const CTX_IDS  = ['p-customer', 'p-corp', 'p-ops', 'sys-core', 'sys-channels', 'sys-swift', 'sys-visa', 'sys-kyc']

// Core banking containers view: sys-core + all subsystems + all containers inside
const CORE_IDS = [
  'sys-core',
  'sub-access',  'ctn-api-gw', 'ctn-auth',
  'sub-banking', 'ctn-accounts', 'ctn-payments', 'ctn-cards',
  'sub-risk',    'ctn-fraud', 'ctn-reporting',
  'sub-platform','ctn-kafka', 'ctn-notif', 'ctn-db-core', 'ctn-db-tx', 'ctn-redis',
]

// Payments domain view
const PAY_IDS  = [
  'p-customer', 'sys-core',
  'sub-access',  'ctn-api-gw',
  'sub-banking', 'ctn-payments', 'ctn-cards',
  'sub-risk',    'ctn-fraud',
  'sub-platform','ctn-db-tx', 'ctn-kafka',
  'sys-swift', 'sys-visa',
]

function _buildPresentations(): Presentation[] {
  return [{
    id: 'pres-walkthrough',
    name: 'Architecture Walkthrough',
    slides: [
      { id: 'slide-1', name: '1 – System Context',          snapshotId: null,      viewId: 'view-ctx',      viewport: { x: 350, y: 40, zoom: 0.55 } },
      { id: 'slide-2', name: '2 – Core Banking Internals',  snapshotId: null,      viewId: 'view-core',     viewport: { x: 60,  y: 40, zoom: 0.55 } },
      { id: 'slide-3', name: '3 – Payments Domain',         snapshotId: null,      viewId: 'view-payments', viewport: { x: 200, y: 80, zoom: 0.65 } },
      { id: 'slide-4', name: '4 – v1 MVP (Milestone)',      snapshotId: 'snap-v1', viewId: null,            viewport: { x: 250, y: 80, zoom: 0.7  } },
      { id: 'slide-5', name: '5 – v4 Full Platform (Milestone)', snapshotId: 'snap-v4', viewId: null,       viewport: { x: 60,  y: 40, zoom: 0.5  } },
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
 * Used as a fallback when no saved override is present.
 */
export function buildFintechSampleRaw(): DiagramData {
  // Bundled static import fallback (populated at first save in old sessions).
  if ((savedSampleData as { nodes?: unknown }).nodes) {
    return JSON.parse(JSON.stringify(savedSampleData)) as DiagramData
  }

  const { allNodes, allRels } = _makeBaseData()

  const nodeMap: Record<string, C4Node> = {}
  for (const n of allNodes) nodeMap[n.id] = { ...n }
  const mainPositions = recordToPos(nodeMap)

  const v1 = pick(allNodes, allRels, V1_NODES, V1_RELS)
  const v2 = pick(allNodes, allRels, V2_NODES, V2_RELS)
  const v3 = pick(allNodes, allRels, V3_NODES, V3_RELS)
  const v4nodes: Record<string, C4Node> = {}
  const v4rels:  Record<string, C4Relation> = {}
  for (const n of allNodes) v4nodes[n.id] = { ...n }
  for (const r of allRels)  v4rels[r.id]  = { ...r }

  const snapshots: DiagramSnapshot[] = [
    { id: 'snap-v1', name: 'v1 – Core & Accounts',   timestamp: Date.now() - 90 * 86400000, nodes: v1.nodes, relations: v1.relations },
    { id: 'snap-v2', name: 'v2 – Payments & Events', timestamp: Date.now() - 60 * 86400000, nodes: v2.nodes, relations: v2.relations },
    { id: 'snap-v3', name: 'v3 – Cards & Fraud',     timestamp: Date.now() - 30 * 86400000, nodes: v3.nodes, relations: v3.relations },
    { id: 'snap-v4', name: 'v4 – Full Platform',     timestamp: Date.now(),                 nodes: v4nodes,  relations: v4rels        },
  ]

  const views: DiagramView[] = [
    { id: 'view-ctx',      name: 'System Context',             nodeIds: CTX_IDS,  positions: mainPositions, viewport: { x: 350, y: 40, zoom: 0.55 } },
    { id: 'view-core',     name: 'Core Banking Containers',    nodeIds: CORE_IDS, positions: mainPositions, viewport: { x: 60,  y: 40, zoom: 0.55 } },
    { id: 'view-payments', name: 'Payments Domain',            nodeIds: PAY_IDS,  positions: mainPositions, viewport: { x: 200, y: 80, zoom: 0.65 } },
  ]

  return {
    nodes: allNodes,
    relations: allRels,
    views,
    snapshots,
    presentations: _buildPresentations(),
    defaultPositions: mainPositions,
  }
}

export async function buildFintechSample(): Promise<DiagramData> {

  // ── If the developer has saved an edited version, use it directly ─────────
  if ((savedSampleData as { nodes?: unknown }).nodes) {
    return JSON.parse(JSON.stringify(savedSampleData)) as DiagramData
  }

  // ── Otherwise build programmatically + apply smart layout ─────────────────

  const { allNodes, allRels } = _makeBaseData()

  // ── Build nodeMap / relMap for main diagram ───────────────────────────────

  const nodeMap: Record<string, C4Node> = {}
  const relMap: Record<string, C4Relation> = {}
  for (const n of allNodes) nodeMap[n.id] = { ...n }
  for (const r of allRels)  relMap[r.id]  = { ...r }

  // ── Layout main diagram ───────────────────────────────────────────────────
  await applyLayoutInPlace(nodeMap, relMap)
  const mainPositions = recordToPos(nodeMap)

  // ── Milestones (each gets its own independent layout) ─────────────────────

  const v1 = pick(allNodes, allRels, V1_NODES, V1_RELS)
  await applyLayoutInPlace(v1.nodes, v1.relations)

  const v2 = pick(allNodes, allRels, V2_NODES, V2_RELS)
  await applyLayoutInPlace(v2.nodes, v2.relations)

  const v3 = pick(allNodes, allRels, V3_NODES, V3_RELS)
  await applyLayoutInPlace(v3.nodes, v3.relations)

  const v4nodes: Record<string, C4Node> = {}
  const v4rels: Record<string, C4Relation> = {}
  for (const n of allNodes) v4nodes[n.id] = { ...n }
  for (const r of allRels)  v4rels[r.id]  = { ...r }
  await applyLayoutInPlace(v4nodes, v4rels)

  const snapshots: DiagramSnapshot[] = [
    { id: 'snap-v1', name: 'v1 – Core & Accounts',   timestamp: Date.now() - 90 * 86400000, nodes: v1.nodes, relations: v1.relations },
    { id: 'snap-v2', name: 'v2 – Payments & Events', timestamp: Date.now() - 60 * 86400000, nodes: v2.nodes, relations: v2.relations },
    { id: 'snap-v3', name: 'v3 – Cards & Fraud',     timestamp: Date.now() - 30 * 86400000, nodes: v3.nodes, relations: v3.relations },
    { id: 'snap-v4', name: 'v4 – Full Platform',     timestamp: Date.now(),                 nodes: v4nodes,  relations: v4rels        },
  ]

  // ── Views (each gets its own layout, merged with main positions) ───────────

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

  const views: DiagramView[] = [
    { id: 'view-ctx',      name: 'System Context',          nodeIds: CTX_IDS,  positions: ctxPositions,  viewport: { x: 350, y: 40, zoom: 0.55 } },
    { id: 'view-core',     name: 'Core Banking Containers', nodeIds: CORE_IDS, positions: corePositions, viewport: { x: 60,  y: 40, zoom: 0.55 } },
    { id: 'view-payments', name: 'Payments Domain',         nodeIds: PAY_IDS,  positions: payPositions,  viewport: { x: 200, y: 80, zoom: 0.65 } },
  ]

  return {
    nodes: Object.values(nodeMap),
    relations: allRels,
    views,
    snapshots,
    presentations: _buildPresentations(),
    defaultPositions: mainPositions,
  }
}
