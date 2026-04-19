/**
 * Reference Layout — hand-crafted ideal layout for the sample C4 diagram.
 *
 * This is a human-designed "golden" layout that demonstrates the intended
 * look of the diagram. It places:
 *   - Persons across the top
 *   - E-Commerce Platform (sys1) centrally with 4 containers in a row
 *   - External systems on the right, aligned with their callers
 *   - Analytics Platform (sys2) below, receiving events from sys1
 *
 * All positions are parent-relative (as required by React Flow nested nodes).
 */

import type { C4Node, PositionMap } from '../types/c4'

// ─── Component sizes ─────────────────────────────────────────────────────────
// Component: 200×100
// Container padding: left=20, top=70, right=20, bottom=20
// 3-component container (vertical stack): 240×450
// 2-component container (vertical stack): 240×310
// Container gap inside system: 20px

export function applyReferenceLayout(
  c4Nodes: Record<string, C4Node>
): PositionMap {
  const result: PositionMap = {}

  function place(
    id: string,
    x: number,
    y: number,
    width?: number,
    height?: number
  ): void {
    if (!c4Nodes[id]) return
    result[id] = { x, y, ...(width != null ? { width } : {}), ...(height != null ? { height } : {}) }
  }

  // ── Layer 0: Persons (top row) ───────────────────────────────────────────
  //
  //   usr1 (Customer)    usr3 (Mobile User)    usr2 (Admin)
  //        ↓                    ↓                 ↓   ↘
  //
  place('usr1', 105, 0)   // above ctn1 (Web Frontend)
  place('usr3', 365, 0)   // above ctn2 (Mobile API)
  place('usr2', 620, 0)   // above ctn3 / near sys2 (connects to both)

  // ── Layer 1: E-Commerce Platform (sys1) ──────────────────────────────────
  //
  //  ┌──────────────────────────────────────────────────────────────────┐
  //  │  sys1: E-Commerce Platform                          1060 × 460  │
  //  │                                                                  │
  //  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
  //  │  │  ctn1   │  │  ctn2   │  │  ctn3   │  │  ctn4   │           │
  //  │  │ WebFront│  │ MobAPI  │  │ OrderSvc│  │ NotifHub│           │
  //  │  │ 240×400 │  │ 240×400 │  │ 240×400 │  │ 240×280 │           │
  //  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
  //  └──────────────────────────────────────────────────────────────────┘
  //
  place('sys1', 0, 180, 1080, 520)

  // Containers inside sys1 (relative to sys1)
  place('ctn1', 20, 70, 240, 450)    // Web Frontend
  place('ctn2', 280, 70, 240, 450)   // Mobile API
  place('ctn3', 540, 70, 240, 450)   // Order Service
  place('ctn4', 800, 70, 240, 310)   // Notification Hub

  // ── Components inside ctn1 (Web Frontend) ─ vertical stack ───────────
  //  cmp1: Product Catalog UI
  //  cmp2: Cart Component
  //  cmp3: Checkout Wizard
  place('cmp1', 20, 70)
  place('cmp2', 20, 190)
  place('cmp3', 20, 310)

  // ── Components inside ctn2 (Mobile API) ─ vertical stack ─────────────
  //  cmp4: Auth Resolver        → ext4 (Legacy CRM)
  //  cmp5: Product Resolver     → cmp9 (Inventory)
  //  cmp6: Order Resolver       → cmp7 (Order Controller)
  place('cmp4', 20, 70)
  place('cmp5', 20, 190)
  place('cmp6', 20, 310)

  // ── Components inside ctn3 (Order Service) ─ vertical stack ──────────
  //  cmp7: Order Controller  (hub: → cmp8, cmp9, cmp10, cmp11)
  //  cmp8: Payment Processor → ext1 (Payment Gateway)
  //  cmp9: Inventory Manager
  place('cmp7', 20, 70)
  place('cmp8', 20, 190)
  place('cmp9', 20, 310)

  // ── Components inside ctn4 (Notification Hub) ─ vertical stack ───────
  //  cmp10: Email Dispatcher → ext2 (Email Service)
  //  cmp11: SMS Dispatcher   → ext3 (SMS Service)
  place('cmp10', 20, 70)
  place('cmp11', 20, 190)

  // ── External systems (right column, aligned with callers) ────────────
  //
  //  ext4 (Legacy CRM)       ← cmp4 in ctn2 (Y ≈ 260)
  //  ext1 (Payment Gateway)  ← cmp8 in ctn3 (Y ≈ 380)
  //  ext2 (Email Service)    ← cmp10 in ctn4 (Y ≈ 260)
  //  ext3 (SMS Service)      ← cmp11 in ctn4 (Y ≈ 380)
  //
  place('ext4', 1140, 220, 240, 100)
  place('ext1', 1140, 360, 240, 100)
  place('ext2', 1140, 500, 240, 100)
  place('ext3', 1140, 640, 240, 100)

  // ── Layer 2: Analytics Platform (sys2) ─ below sys1, offset right ────
  //
  //  ┌──────────────────────────────────┐
  //  │  sys2: Analytics Platform 540×340│
  //  │  ┌─────────┐  ┌─────────┐       │
  //  │  │  ctn5   │  │  ctn6   │       │
  //  │  │DataPipe │  │Dashboard│       │
  //  │  │ 240×280 │  │ 240×280 │       │
  //  │  └─────────┘  └─────────┘       │
  //  └──────────────────────────────────┘
  //
  //  Receives events from ctn1 (x≈140) and ctn3 (x≈660), so centered ≈ x=200
  //  Below sys1 bottom (180+460=640) with 40px gap → y=680
  //
  place('sys2', 200, 760, 560, 400)

  // Containers inside sys2 (relative to sys2)
  place('ctn5', 20, 70, 240, 310)    // Data Pipeline
  place('ctn6', 280, 70, 240, 310)   // Dashboard

  // ── Components inside ctn5 (Data Pipeline) ─ vertical stack ──────────
  //  cmp12: Event Collector
  //  cmp13: Stream Processor → cmp14
  place('cmp12', 20, 70)
  place('cmp13', 20, 190)

  // ── Components inside ctn6 (Dashboard) ─ vertical stack ──────────────
  //  cmp14: Metrics API       ← cmp13
  //  cmp15: Report Generator  ← cmp14
  place('cmp14', 20, 70)
  place('cmp15', 20, 190)

  return result
}
