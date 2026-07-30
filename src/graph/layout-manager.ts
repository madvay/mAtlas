import type cytoscape from 'cytoscape';
import type { AppState, GraphNode, LayoutName, Point } from '../types.js';
import type { GraphModel } from '../model/graph-model.js';
import { compactHierarchyPositions } from './compact-hierarchy-layout-core.js';

interface LayoutManagerOptions {
  cy: cytoscape.Core;
  model: GraphModel;
  state: AppState;
  onStateChange: () => void;
  onLayoutSettled: () => void;
}

interface AtlasBlock {
  fieldId: string;
  level: number;
  domain: string;
  nodes: GraphNode[];
  center: number;
  spacing: number;
  nodeSpan: number;
  halfNodeWidth: number;
  left?: number;
}

export class LayoutManager {
  constructor(private readonly options: LayoutManagerOptions) {}

  run(name: LayoutName = this.options.state.layout, fitAfter = true): void {
    const { cy, state } = this.options;
    const layoutChanged = state.layout !== name;
    state.layout = name;
    const select = document.getElementById('layoutSelect');
    if (select instanceof HTMLSelectElement) select.value = name;
    if (layoutChanged) this.options.onStateChange();
    const visible = cy.elements().not('.filter-hidden');

    if (name === 'atlas') {
      const positions = this.atlasPositions();
      cy.nodes().positions((node) => positions[node.id()] ?? { x: 0, y: 0 });
      if (fitAfter) cy.fit(visible, 58);
      this.options.onLayoutSettled();
      return;
    }

    const visibleNodeIds = new Set<string>();
    visible.nodes().forEach((node) => {
      visibleNodeIds.add(node.id());
    });
    const positions = compactHierarchyPositions(
      this.options.model.data.nodes,
      visibleNodeIds,
      this.options.model.data.domains,
      this.options.model.domainOrder
    );
    visible.nodes().positions((node) => positions[node.id()] ?? { x: 0, y: 0 });
    if (fitAfter) cy.fit(visible, 58);
    this.options.onLayoutSettled();
  }

  atlasPositions(): Record<string, Point> {
    const { model } = this.options;
    const centers = this.domainCenters();
    const fieldBases = this.fieldBaseLevels();
    const positions: Record<string, Point> = {};
    const groups = new Map<string, GraphNode[]>();

    for (const node of model.data.nodes) {
      const fieldId = model.nodePrimaryField(node);
      const key = `${fieldId}|${node.level}|${node.primaryDomain}`;
      const group = groups.get(key) ?? [];
      group.push(node);
      groups.set(key, group);
    }

    const levelGroups = new Map<string, AtlasBlock[]>();
    for (const [key, group] of groups) {
      const [fieldId = '', levelText = '0', domain = ''] = key.split('|');
      const level = Number(levelText);
      group.sort((a, b) => a.kind === b.kind
        ? a.label.localeCompare(b.label)
        : a.kind === 'structure' ? -1 : 1);
      const spacing = group.some((node) => node.kind === 'structure') ? 205 : 175;
      const center = centers[domain] ?? 0;
      const nodeSpan = spacing * Math.max(0, group.length - 1);
      const maxNodeWidth = Math.max(...group.map((node) => node.kind === 'junction' ? 116 : 164));
      const levelKey = `${fieldId}|${level}`;
      const collection = levelGroups.get(levelKey) ?? [];
      collection.push({
        fieldId,
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
        const y = ((fieldBases[block.fieldId] ?? 0) + block.level) * 180;
        block.nodes.forEach((node, index) => {
          positions[node.id] = { x: (block.left ?? 0) + index * block.spacing, y };
        });
      }
    }

    if (positions.set) positions.set = { x: 0, y: 0 };
    return positions;
  }

  private domainCenters(): Record<string, number> {
    const { model } = this.options;
    const centers: Record<string, number> = {};
    for (const fieldId of model.fieldOrder) {
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

  private fieldBaseLevels(): Record<string, number> {
    const { model } = this.options;
    const bases: Record<string, number> = {};
    let nextBase = 0;
    for (const fieldId of model.fieldOrder) {
      bases[fieldId] = nextBase;
      const levels = model.data.nodes
        .filter((node) => model.nodePrimaryField(node) === fieldId)
        .map((node) => node.level);
      nextBase += (levels.length ? Math.max(...levels) : 0) + 4;
    }
    return bases;
  }

}
