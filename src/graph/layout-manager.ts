import type cytoscape from 'cytoscape';
import type { AppState, GraphNode, LayoutName, Point } from '../types.js';
import type { GraphModel } from '../model/graph-model.js';
import { compactHierarchyPositions } from './compact-hierarchy-layout-core.js';

interface LayoutManagerOptions {
  cy: cytoscape.Core;
  model: GraphModel;
  state: AppState;
  onStateChange: () => void;
  animateGraph: () => boolean;
  refitOnChange: () => boolean;
  onLayoutStarted: (name: LayoutName, animated: boolean) => void;
  onLayoutPrepared: (name: LayoutName) => void;
  onLayoutSettled: () => void;
  fitVisible: (elements: cytoscape.CollectionReturnValue, padding?: number, onComplete?: () => void) => void;
  cancelFit: () => void;
}

interface ActiveLayoutRun {
  id: number;
  layout: cytoscape.Layouts | null;
  settled: boolean;
}

interface AtlasBlock {
  level: number;
  domain: string;
  nodes: GraphNode[];
  center: number;
  spacing: number;
  nodeSpan: number;
  halfNodeWidth: number;
  left?: number;
}

// Chemistry is not a vertically appended field.  These lanes put its domains
// beside the Physics areas with which they have the closest structural or
// experimental contact; offsets keep adjacent Chemistry domains legible.
const CHEMISTRY_LANE_ANCHORS: Readonly<Record<string, { physicsDomain: string; offset: number }>> = Object.freeze({
  'chemical-foundations': { physicsDomain: 'atomic-molecular-physics', offset: -900 },
  'atomic-structure-periodicity': { physicsDomain: 'atomic-molecular-physics', offset: -200 },
  'molecular-structure-bonding': { physicsDomain: 'atomic-molecular-physics', offset: 350 },
  'quantum-chemistry-spectroscopy': { physicsDomain: 'atomic-molecular-physics', offset: -550 },
  'chemical-thermodynamics-equilibrium': { physicsDomain: 'thermodynamics-statistical-mechanics', offset: 0 },
  'solutions-interfaces': { physicsDomain: 'thermodynamics-statistical-mechanics', offset: 540 },
  'chemical-kinetics-dynamics': { physicsDomain: 'thermodynamics-statistical-mechanics', offset: 1060 },
  'inorganic-coordination-chemistry': { physicsDomain: 'atomic-molecular-physics', offset: -250 },
  'organic-chemistry': { physicsDomain: 'atomic-molecular-physics', offset: -1050 },
  'analytical-chemistry': { physicsDomain: 'atomic-molecular-physics', offset: 500 },
  electrochemistry: { physicsDomain: 'thermodynamics-statistical-mechanics', offset: -580 },
  radiochemistry: { physicsDomain: 'nuclear-physics', offset: 0 },
  'materials-polymer-chemistry': { physicsDomain: 'condensed-matter-physics', offset: 0 },
  'biochemistry-chemical-biology': { physicsDomain: 'atomic-molecular-physics', offset: -900 },
  'environmental-atmospheric-chemistry': { physicsDomain: 'thermodynamics-statistical-mechanics', offset: 850 },
  'industrial-process-chemistry': { physicsDomain: 'thermodynamics-statistical-mechanics', offset: -350 },
  'chemistry-experiments-evidence': { physicsDomain: 'experiments-observations', offset: 0 }
});

// Physics and Chemistry share one vertical band: a Chemistry level therefore
// remains directly comparable to the corresponding Physics level.  That band
// begins after the highest Mathematics level, preserving the atlas's intended
// broad progression from formal structures to physical systems while retaining
// the Physics--Chemistry integration within the scientific band.
const MATHEMATICS_TO_SCIENCE_GAP = 4;

export class LayoutManager {
  private activeRun: ActiveLayoutRun | null = null;
  private nextRunId = 1;

  constructor(private readonly options: LayoutManagerOptions) {}

  run(name: LayoutName = this.options.state.layout, fitAfter = true): void {
    this.cancel();
    const { cy, state } = this.options;
    const layoutChanged = state.layout !== name;
    state.layout = name;
    const select = document.getElementById('layoutSelect');
    if (select instanceof HTMLSelectElement) select.value = name;
    if (layoutChanged) this.options.onStateChange();
    const layered = name === 'atlas' || name === 'domains' || name === 'fields';
    let nodes: cytoscape.CollectionReturnValue;
    let positions: Record<string, Point>;
    if (layered) {
      nodes = cy.nodes().not('[semanticOverlay = 1]');
      positions = this.atlasPositions();
    } else {
      const visible = cy.elements().not('.filter-hidden');
      nodes = visible.nodes().not('[semanticOverlay = 1]');
      const visibleNodeIds = new Set<string>();
      nodes.forEach((node) => {
        visibleNodeIds.add(node.id());
      });
      positions = compactHierarchyPositions(
        this.options.model.data.nodes,
        visibleNodeIds,
        this.options.model.data.domains,
        this.options.model.domainOrder
      );
    }

    const animatePositions = this.options.animateGraph() && this.positionsChanged(nodes, positions);
    const animated = animatePositions || (fitAfter && this.options.refitOnChange() && this.options.animateGraph());
    this.options.onLayoutStarted(name, animated);

    const run: ActiveLayoutRun = {
      id: this.nextRunId++,
      layout: null,
      settled: false
    };
    this.activeRun = run;
    const prepared = (): void => this.finishPositioning(run, name, fitAfter);

    if (!animatePositions) {
      nodes.positions((node) => positions[node.id()] ?? node.position());
      prepared();
      return;
    }

    const presetPositions: Record<string, cytoscape.Position> = {};
    nodes.forEach((node) => {
      const position = positions[node.id()] ?? node.position();
      presetPositions[node.id()] = { x: position.x, y: position.y };
    });
    nodes.stop(true, false);
    const layout = nodes.layout({
      name: 'preset',
      positions: presetPositions,
      animate: true,
      animationDuration: 500,
      animationEasing: 'ease-in-out',
      fit: false,
      stop: prepared
    });
    run.layout = layout;
    layout.run();
  }

  cancel(): void {
    const run = this.activeRun;
    if (!run) {
      this.options.cancelFit();
      this.options.cy.nodes().stop(true, false);
      return;
    }
    this.activeRun = null;
    run.layout?.stop();
    this.options.cy.nodes().stop(true, false);
    this.options.cancelFit();
    this.settle(run);
  }

  private positionsChanged(nodes: cytoscape.CollectionReturnValue, positions: Record<string, Point>): boolean {
    let changed = false;
    nodes.forEach((node) => {
      if (changed) return;
      const target = positions[node.id()];
      if (!target) return;
      const current = node.position();
      if (Math.hypot(current.x - target.x, current.y - target.y) > 0.5) changed = true;
    });
    return changed;
  }

  private finishPositioning(run: ActiveLayoutRun, name: LayoutName, fitAfter: boolean): void {
    if (this.activeRun?.id !== run.id) return;
    run.layout = null;
    this.options.onLayoutPrepared(name);
    if (!fitAfter) {
      this.finishRun(run);
      return;
    }
    const visible = this.options.cy.elements().not('.filter-hidden')
      .filter((element) => element.style('display') !== 'none');
    this.options.fitVisible(visible, undefined, () => this.finishRun(run));
  }

  private finishRun(run: ActiveLayoutRun): void {
    if (this.activeRun?.id !== run.id) return;
    this.activeRun = null;
    this.settle(run);
  }

  private settle(run: ActiveLayoutRun): void {
    if (run.settled) return;
    run.settled = true;
    this.options.onLayoutSettled();
  }

  atlasPositions(): Record<string, Point> {
    const { model } = this.options;
    const centers = this.domainCenters();
    const scienceBaseLevel = this.scienceBaseLevel();
    const positions: Record<string, Point> = {};
    const groups = new Map<string, GraphNode[]>();

    for (const node of model.data.nodes) {
      const fieldId = model.nodePrimaryField(node);
      const displayLevel = node.level + ((fieldId === 'physics' || fieldId === 'chemistry') ? scienceBaseLevel : 0);
      const key = `${displayLevel}|${node.primaryDomain}`;
      const group = groups.get(key) ?? [];
      group.push(node);
      groups.set(key, group);
    }

    const levelGroups = new Map<string, AtlasBlock[]>();
    for (const [key, group] of groups) {
      const [levelText = '0', domain = ''] = key.split('|');
      const level = Number(levelText);
      group.sort((a, b) => a.kind === b.kind
        ? a.label.localeCompare(b.label)
        : a.kind === 'structure' ? -1 : 1);
      const spacing = group.some((node) => node.kind === 'structure') ? 205 : 175;
      const center = centers[domain] ?? 0;
      const nodeSpan = spacing * Math.max(0, group.length - 1);
      const maxNodeWidth = Math.max(...group.map((node) => node.kind === 'junction' ? 116 : 164));
      const levelKey = `${level}`;
      const collection = levelGroups.get(levelKey) ?? [];
      collection.push({
        level,
        domain,
        nodes: group,
        center,
        spacing,
        nodeSpan,
        halfNodeWidth: maxNodeWidth / 2
      });
      levelGroups.set(levelKey, collection);
    }

    for (const blocks of levelGroups.values()) {
      blocks.sort((a, b) => a.center - b.center || a.domain.localeCompare(b.domain));
      const minGap = 40;
      let nextLeft = Number.NEGATIVE_INFINITY;
      for (const block of blocks) {
        const idealLeft = block.center - block.nodeSpan / 2;
        const physicalLeft = idealLeft - block.halfNodeWidth;
        block.left = physicalLeft < nextLeft ? idealLeft + nextLeft - physicalLeft : idealLeft;
        nextLeft = block.left + block.nodeSpan + block.halfNodeWidth * 2 + minGap;
      }
      const actualCenter = blocks.reduce((sum, block) => sum + (block.left ?? 0) + block.nodeSpan / 2, 0) / blocks.length;
      const desiredCenter = blocks.reduce((sum, block) => sum + block.center, 0) / blocks.length;
      const shift = desiredCenter - actualCenter;
      for (const block of blocks) block.left = (block.left ?? 0) + shift;

      for (const block of blocks) {
        const y = block.level * 180;
        block.nodes.forEach((node, index) => {
          positions[node.id] = { x: (block.left ?? 0) + index * block.spacing, y };
        });
      }
    }

    if (positions.set) positions.set = { x: 0, y: 0 };
    return positions;
  }

  private scienceBaseLevel(): number {
    const { model } = this.options;
    const mathematicsLevels = model.data.nodes
      .filter((node) => model.nodePrimaryField(node) === 'mathematics')
      .map((node) => node.level);
    const scienceLevels = model.data.nodes
      .filter((node) => {
        const fieldId = model.nodePrimaryField(node);
        return fieldId === 'physics' || fieldId === 'chemistry';
      })
      .map((node) => node.level);
    if (!mathematicsLevels.length || !scienceLevels.length) return 0;
    return Math.max(...mathematicsLevels) - Math.min(...scienceLevels) + MATHEMATICS_TO_SCIENCE_GAP;
  }

  private domainCenters(): Record<string, number> {
    const { model } = this.options;
    const centers: Record<string, number> = {};
    const fieldIds = [
      ...model.fieldOrder.filter((fieldId) => fieldId !== 'chemistry'),
      ...model.fieldOrder.filter((fieldId) => fieldId === 'chemistry')
    ];
    for (const fieldId of fieldIds) {
      const fieldDomains = model.domainOrder.filter((id) => model.fieldForDomain(id) === fieldId);
      const laneSpacing = fieldDomains.length > 14 ? 720 : fieldDomains.length > 8 ? 650 : 560;
      if (fieldId === 'mathematics' && fieldDomains.includes('set-theory')) {
        const rightStart = fieldDomains.indexOf('number-theory');
        const splitIndex = rightStart >= 0 ? rightStart : fieldDomains.length;
        const leftDomains = fieldDomains.slice(0, splitIndex).filter((id) => id !== 'set-theory');
        const rightDomains = fieldDomains.slice(splitIndex);
        centers['set-theory'] = 0;
        leftDomains.forEach((id, index) => {
          centers[id] = -(leftDomains.length - index) * laneSpacing;
        });
        rightDomains.forEach((id, index) => { centers[id] = (index + 1) * laneSpacing; });
        continue;
      }

      if (fieldId === 'physics' && fieldDomains.includes('quantum-mechanics')) {
        const pivotIndex = fieldDomains.indexOf('quantum-mechanics');
        const leftDomains = fieldDomains.slice(0, pivotIndex);
        const rightDomains = fieldDomains.slice(pivotIndex + 1);
        centers['quantum-mechanics'] = 0;
        leftDomains.reverse().forEach((id, index) => {
          centers[id] = -(index + 1) * laneSpacing;
        });
        rightDomains.forEach((id, index) => {
          centers[id] = (index + 1) * laneSpacing;
        });
        continue;
      }

      if (fieldId === 'chemistry') {
        for (const id of fieldDomains) {
          const anchor = CHEMISTRY_LANE_ANCHORS[id];
          const physicsCenter = anchor ? centers[anchor.physicsDomain] : undefined;
          if (anchor && physicsCenter !== undefined) {
            centers[id] = physicsCenter + anchor.offset;
            continue;
          }
          centers[id] = 0;
        }
        continue;
      }

      const buckets = new Map<number, string[]>();
      for (const id of fieldDomains) {
        const order = model.data.domains[id]?.order ?? 0;
        const bucket = buckets.get(order) ?? [];
        bucket.push(id);
        buckets.set(order, bucket);
      }
      const orderedValues = [...buckets.keys()].sort((a, b) => a - b);
      orderedValues.forEach((order, index) => {
        const center = (index - (orderedValues.length - 1) / 2) * laneSpacing;
        for (const id of buckets.get(order) ?? []) centers[id] = center;
      });
    }
    return centers;
  }
}
