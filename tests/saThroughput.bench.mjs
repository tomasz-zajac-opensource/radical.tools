/**
 * Benchmark: SA iterations achieved within a fixed wall-clock budget.
 *
 * Runs `runSmartLayout` on a moderately complex scenario (the fintech-ish
 * synthetic graph below) and reports SA throughput as iterations/second.
 *
 * Run: node --import tsx tests/saThroughput.bench.mjs
 */

const { runSmartLayout } = await import(
  '../src/renderer/src/layout/smartLayout.ts'
)

function N(id, type, label, w, h, extras = {}) {
  return { id, type, label, width: w, height: h, x: 0, y: 0, collapsed: false, ...extras }
}
function R(id, s, t) { return { id, sourceId: s, targetId: t } }

function fintechLike() {
  const nodes = [
    N('person',   'person',  'Customer',     120, 70),
    N('extPay',   'system',  'PaymentNet',   140, 70, { external: true }),
    N('extKyc',   'system',  'KYC Provider', 140, 70, { external: true }),
    N('sys',      'system',  'FinCore',      900, 600),
    N('subAccess','system',  'Access',       260, 200, { parentId: 'sys' }),
    N('ctnGw',    'container','API Gateway', 200, 80,  { parentId: 'subAccess' }),
    N('ctnAuth',  'container','Auth',        200, 80,  { parentId: 'subAccess' }),
    N('subBank',  'system',  'Banking',      380, 300, { parentId: 'sys' }),
    N('ctnAcc',   'container','Accounts',    180, 80,  { parentId: 'subBank' }),
    N('ctnPay',   'container','Payments',    180, 80,  { parentId: 'subBank' }),
    N('ctnCard',  'container','Cards',       180, 80,  { parentId: 'subBank' }),
    N('subRisk',  'system',  'Risk',         300, 200, { parentId: 'sys' }),
    N('ctnFraud', 'container','Fraud',       180, 80,  { parentId: 'subRisk' }),
    N('ctnRep',   'container','Reporting',   180, 80,  { parentId: 'subRisk' }),
    N('subPlat',  'system',  'Platform',     420, 200, { parentId: 'sys' }),
    N('ctnKafka', 'queue',   'Kafka',        130, 70, { parentId: 'subPlat' }),
    N('ctnNotif', 'container','Notifier',    180, 80,  { parentId: 'subPlat' }),
    N('ctnDbCore','database','Core DB',      130, 80, { parentId: 'subPlat' }),
    N('ctnDbTx',  'database','Tx DB',        130, 80, { parentId: 'subPlat' }),
    N('ctnRedis', 'database','Redis',        130, 80, { parentId: 'subPlat' }),
  ]
  const relations = [
    R('e1',  'person',   'ctnGw'),
    R('e2',  'ctnGw',    'ctnAuth'),
    R('e3',  'ctnGw',    'ctnAcc'),
    R('e4',  'ctnGw',    'ctnPay'),
    R('e5',  'ctnGw',    'ctnCard'),
    R('e6',  'ctnAuth',  'extKyc'),
    R('e7',  'ctnAcc',   'ctnDbCore'),
    R('e8',  'ctnPay',   'ctnDbTx'),
    R('e9',  'ctnPay',   'ctnKafka'),
    R('e10', 'ctnPay',   'extPay'),
    R('e11', 'ctnCard',  'ctnDbTx'),
    R('e12', 'ctnFraud', 'ctnKafka'),
    R('e13', 'ctnFraud', 'ctnDbTx'),
    R('e14', 'ctnRep',   'ctnDbCore'),
    R('e15', 'ctnRep',   'ctnDbTx'),
    R('e16', 'ctnNotif', 'ctnKafka'),
    R('e17', 'ctnAuth',  'ctnRedis'),
    R('e18', 'ctnGw',    'ctnRedis'),
  ]
  const nodeMap = {}
  for (const n of nodes) nodeMap[n.id] = n
  const relMap = {}
  for (const r of relations) relMap[r.id] = r
  return { nodes: nodeMap, relations: relMap }
}

const RUNS = 5
const totals = { wall: [], iter: [], composite: [] }
for (let i = 0; i < RUNS; i++) {
  const { nodes, relations } = fintechLike()
  const t0 = performance.now()
  const result = await runSmartLayout(nodes, relations)
  const dt = performance.now() - t0
  totals.wall.push(dt)
  totals.iter.push(result.refinement.iterations)
  totals.composite.push(result.winner.score.composite)
  console.log(
    `run ${i + 1}: ${dt.toFixed(0)}ms  iter=${result.refinement.iterations}  ` +
    `iter/s=${(result.refinement.iterations / (dt / 1000)).toFixed(0)}  ` +
    `composite=${result.winner.score.composite.toFixed(1)}  ` +
    `crossings=${result.winner.score.renderedCrossings}`,
  )
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length
console.log(
  `\navg: wall=${avg(totals.wall).toFixed(0)}ms  ` +
  `iter=${avg(totals.iter).toFixed(0)}  ` +
  `iter/s=${(avg(totals.iter) / (avg(totals.wall) / 1000)).toFixed(0)}  ` +
  `composite=${avg(totals.composite).toFixed(1)}`,
)
