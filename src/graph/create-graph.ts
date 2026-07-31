import cytoscape from 'cytoscape';
import type { GraphModel } from '../model/graph-model.js';
import { stableStringHash } from '../core/hash.js';
import { hasInlineMathText, stripInlineMathText } from '../core/text.js';
import type { LabelSizer } from './label-sizer.js';
import { DEFAULT_INTERACTIVE_MIN_ZOOM } from './viewport-fit-core.js';
import type { Preferences } from '../types.js';

function edgeCurveDistance(edgeId: string): number {
  const hash = stableStringHash(edgeId);
  const magnitude = 34 + (hash % 31);
  return (hash & 1) === 0 ? magnitude : -magnitude;
}

export function createGraphElements(model: GraphModel, labels: LabelSizer): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];
  for (const node of model.data.nodes) {
    const primaryDomain = model.data.domains[node.primaryDomain] ?? model.data.domains.foundation;
    if (!primaryDomain) throw new Error(`Node ${node.id} has an unknown primary domain: ${node.primaryDomain}`);
    const domainIds = model.nodeDomainIds(node);
    const displayLabel = stripInlineMathText(node.label);
    const hasMathLabel = hasInlineMathText(node.label);
    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: node.label,
        displayLabel,
        canvasLabel: hasMathLabel ? '' : displayLabel,
        hasMathLabel: hasMathLabel ? 1 : 0,
        labelFontSize: labels.semanticSize(node, 1, displayLabel),
        kind: node.kind,
        primaryField: model.nodePrimaryField(node),
        fieldIds: model.nodeFieldIds(node).join(' '),
        primaryDomain: node.primaryDomain,
        domainIds: domainIds.join(' '),
        domainLabels: model.nodeDomainLabels(node).join(', '),
        domainColor: primaryDomain.color,
        domainColors: domainIds.map((id) => model.data.domains[id]?.color ?? '#64748b'),
        multiDomain: node.kind === 'structure' && domainIds.length > 1 ? 1 : 0,
        level: node.level,
        summary: node.summary,
        conceptType: node.conceptType ?? ''
      }
    });
  }

  for (const edge of model.allEdges) {
    const type = model.data.edgeTypes[edge.type];
    if (!type) throw new Error(`Edge ${edge.id} has an unknown type: ${edge.type}`);
    const displayLabel = stripInlineMathText(edge.label);
    const hasMathLabel = hasInlineMathText(edge.label);
    elements.push({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        typeLabel: type.label,
        typeColor: type.color,
        lineStyle: type.lineStyle ?? 'solid',
        label: edge.label,
        displayLabel,
        canvasLabel: hasMathLabel ? '' : displayLabel,
        hasMathLabel: hasMathLabel ? 1 : 0,
        detail: edge.detail,
        synthetic: edge.synthetic ? 1 : 0,
        junctionId: edge.junctionId ?? '',
        overview: edge.overview ? 1 : 0,
        curveDistance: edgeCurveDistance(edge.id)
      }
    });
  }
  return elements;
}

export const graphStyles: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      shape: 'round-rectangle', width: 164, height: 58, padding: '4px',
      'background-color': 'data(domainColor)', 'background-opacity': 0.92,
      'border-width': 2, 'border-color': '#ffffff', label: 'data(canvasLabel)', color: '#ffffff',
      'font-size': 'data(labelFontSize)', 'font-weight': 600, 'text-wrap': 'wrap',
      'text-overflow-wrap': 'whitespace', 'text-max-width': '144px', 'text-halign': 'center',
      'text-valign': 'center', 'text-outline-width': 0, 'overlay-opacity': 0
    }
  },
  {
    selector: 'node[kind = "junction"]',
    style: {
      width: 116, 'background-color': '#fff7ed', 'background-opacity': 1,
      'border-width': 3, 'border-color': '#b45309',
      'border-style': 'dashed', color: '#7c2d12', 'text-max-width': '92px'
    }
  },
  {
    selector: 'edge',
    style: {
      width: 2.1, 'curve-style': 'bezier', 'control-point-distances': 'data(curveDistance)',
      'control-point-weights': 0.5, 'line-color': 'data(typeColor)',
      'target-arrow-color': 'data(typeColor)', 'target-arrow-shape': 'triangle',
      'arrow-scale': 0.85, 'line-style': 'data(lineStyle)' as unknown as cytoscape.Css.Edge['line-style'], label: 'data(canvasLabel)',
      'font-size': 9, 'font-weight': 600, color: '#334155', 'text-wrap': 'wrap',
      'text-max-width': '120px', 'text-background-color': '#ffffff', 'text-background-opacity': 0.88,
      'text-background-padding': '3px', 'text-border-width': 1, 'text-border-color': '#e2e8f0',
      'text-border-opacity': 0.85, 'text-rotation': 'autorotate', 'source-distance-from-node': 4,
      'target-distance-from-node': 5, 'overlay-opacity': 0
    }
  },
  {
    selector: 'edge[synthetic = 1]',
    style: {
      width: 2.6, 'line-style': 'dashed', 'text-background-color': '#fff7ed',
      'text-border-color': '#fed7aa', 'text-border-opacity': 1, 'text-max-width': '138px'
    }
  },
  { selector: '.edge-labels-off', style: { label: '' } },
  { selector: '.filter-hidden', style: { display: 'none' } },
  { selector: '.hover-dim', style: { opacity: 0.18 } },
  { selector: 'node.neighborhood-dim', style: { opacity: 0.46 } },
  { selector: 'edge.neighborhood-dim', style: { display: 'none' } },
  { selector: '.neighborhood-emphasis', style: { opacity: 1 } },
  { selector: 'node.neighborhood-emphasis', style: { 'border-width': 4, 'border-color': '#f59e0b' } },
  { selector: '.search-match', style: { 'border-width': 5, 'border-color': '#facc15', 'background-opacity': 1 } },
  { selector: 'node.comparison-a', style: { 'border-width': 5, 'border-color': '#7c3aed', 'background-opacity': 1 } },
  { selector: 'node.comparison-b', style: { 'border-width': 5, 'border-color': '#0891b2', 'border-style': 'dashed', 'background-opacity': 1 } },
  { selector: 'node.comparison-shared', style: { 'border-width': 4, 'border-color': '#65a30d', 'background-opacity': 1 } },
  { selector: 'edge.comparison-direct', style: { display: 'element', opacity: 1, width: 5, 'z-index': 997 } },
  { selector: '.hover-emphasis', style: { opacity: 1 } },
  { selector: 'node.dependency-faded', style: { 'background-opacity': 0.46 } },
  { selector: 'edge.dependency-context', style: { opacity: 0.46 } },
  { selector: 'node.dependency-faded.prerequisite-undimmed', style: { 'background-opacity': 0.92 } },
  { selector: 'edge.dependency-context.prerequisite-undimmed', style: { opacity: 1 } },
  { selector: 'node.dependency-faded.hover-emphasis, edge.dependency-context.hover-emphasis', style: { opacity: 0.68 } },
  {
    selector: 'node.prerequisite-highlight',
    style: {
      opacity: 1, 'background-color': '#bae6fd', 'background-opacity': 1,
      'border-width': 4, 'border-color': '#38bdf8', color: '#0c4a6e'
    }
  },
  {
    selector: 'edge.prerequisite-highlight',
    style: {
      display: 'element', opacity: 1, width: 4, 'line-color': '#7dd3fc',
      'target-arrow-color': '#7dd3fc', 'z-index': 998
    }
  },
  { selector: 'node.prerequisite-highlight.search-match', style: { 'border-width': 5, 'border-color': '#facc15' } },
  { selector: 'node.connection-dim', style: { opacity: 0.2 } },
  { selector: 'edge.connection-dim', style: { opacity: 0.06, events: 'no' } },
  { selector: 'node.connection-emphasis', style: { opacity: 1, 'border-width': 4, 'border-color': '#2563eb', 'z-index': 997 } },
  { selector: 'edge.connection-emphasis', style: { display: 'element', opacity: 1, width: 5, 'line-color': '#2563eb', 'target-arrow-color': '#2563eb', 'z-index': 997 } },
  { selector: 'node.connection-endpoint', style: { 'border-width': 6, 'border-color': '#1d4ed8', 'background-opacity': 1 } },
  { selector: 'node:selected', style: { 'border-width': 5, 'border-color': '#0f172a', 'background-opacity': 1 } },
  { selector: 'edge:selected', style: { width: 5, 'z-index': 999 } },
  {
    selector: 'node.structure-source-node',
    style: {
      label: '', opacity: 0.25, 'background-opacity': 1,
      'border-width': 1, 'border-color': '#ffffff', 'z-index': 1,
      events: 'no', 'transition-property': 'none', 'transition-duration': 0
    }
  },
  {
    selector: 'node.structure-source-junction',
    style: { display: 'none', 'transition-property': 'none', 'transition-duration': 0 }
  },
  {
    selector: 'edge.structure-source-edge',
    style: { display: 'none', events: 'no', 'transition-property': 'none', 'transition-duration': 0 }
  },
  {
    selector: 'node[semanticGroup = 1]',
    style: {
      shape: 'rectangle', width: 'data(nodeWidth)', height: 'data(nodeHeight)',
      'background-opacity': 0, 'border-width': 0,
      label: 'data(canvasLabel)', color: 'data(color)',
      'font-size': 'data(labelFontSize)', 'font-weight': 800,
      'text-wrap': 'wrap', 'text-max-width': 'data(textWidth)',
      'text-halign': 'center', 'text-valign': 'center',
      'text-outline-color': '#ffffff', 'text-outline-opacity': 0.92,
      'text-outline-width': 'data(textOutlineWidth)',
      opacity: 1, 'z-index': 1000, events: 'yes'
    }
  },
  {
    selector: 'node[semanticGroup = 1]:selected',
    style: {
      'background-opacity': 0, 'border-width': 0,
      'text-outline-color': '#ffffff',
      'text-outline-width': 'data(selectedTextOutlineWidth)',
      opacity: 1, 'z-index': 1002
    }
  },
  {
    selector: 'edge[semanticConnection = 1]',
    style: {
      width: 'data(edgeWidth)', 'curve-style': 'bezier',
      'control-point-distances': 'data(curveDistance)', 'control-point-weights': 0.5,
      'line-color': 'data(structureColor)', 'target-arrow-color': 'data(structureColor)',
      'target-arrow-shape': 'triangle', 'arrow-scale': 1.05,
      label: 'data(canvasLabel)', color: '#172033', 'font-size': 11, 'font-weight': 800,
      'text-background-color': '#ffffff', 'text-background-opacity': 0.94,
      'text-background-padding': '4px', 'text-border-width': 1,
      'text-border-color': '#cbd5e1', 'text-border-opacity': 0.9,
      'text-rotation': 'autorotate', opacity: 0.09, events: 'yes', 'z-index': 999
    }
  },
  {
    selector: 'edge[semanticConnection = 1].structure-connection-emphasis',
    style: { opacity: 1, 'z-index': 1000 }
  },
  {
    selector: 'edge[semanticConnection = 1].structure-connection-hidden',
    style: { display: 'none', events: 'no' }
  },
  {
    selector: 'edge[semanticConnection = 1]:selected',
    style: {
      width: 'data(selectedEdgeWidth)', opacity: 1,
      'line-color': '#0f172a', 'target-arrow-color': '#0f172a', 'z-index': 1001
    }
  }
];

export function createGraph(container: HTMLElement, model: GraphModel, labels: LabelSizer, preferences: Preferences): cytoscape.Core {
  const cy = cytoscape({
    container,
    elements: createGraphElements(model, labels),
    layout: { name: 'preset' },
    minZoom: DEFAULT_INTERACTIVE_MIN_ZOOM,
    maxZoom: 3,
    wheelSensitivity: 0.18,
    // High-density mobile displays otherwise render several times as many canvas
    // pixels. Edges are the most expensive part of a viewport gesture, so omit
    // them only while the viewport is actively moving.
    pixelRatio: preferences.highResolution ? 'auto' : Math.min(window.devicePixelRatio || 1, 1.5),
    hideEdgesOnViewport: preferences.hideEdgesWhileMoving,
    motionBlur: preferences.motionBlur,
    boxSelectionEnabled: false,
    autoungrabify: !preferences.allowNodeMovement,
    style: graphStyles
  });
  applyRendererPreferences(cy, preferences);
  return cy;
}

export function applyRendererPreferences(cy: cytoscape.Core, preferences: Preferences): void {
  // These are the live fields used by Cytoscape's canvas renderer. Updating only
  // its original options object would not change an already-created renderer.
  const renderer = (cy as unknown as { renderer: () => {
    forcedPixelRatio: number | null;
    motionBlurEnabled: boolean;
    motionBlur: boolean;
    hideEdgesOnViewport: boolean;
  } }).renderer();
  renderer.forcedPixelRatio = preferences.highResolution ? null : Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.motionBlurEnabled = preferences.motionBlur;
  renderer.motionBlur = preferences.motionBlur;
  renderer.hideEdgesOnViewport = preferences.hideEdgesWhileMoving;
  cy.autoungrabify(!preferences.allowNodeMovement);
  const nodes = cy.nodes();
  if (preferences.allowNodeMovement) {
    nodes.unpanify();
    nodes.grabify();
  } else {
    nodes.ungrabify();
    nodes.panify();
  }
  cy.style()
    .selector('node').style('transition-property', preferences.transitions ? 'opacity, border-width, border-color, background-color, background-opacity, color' : 'none')
    .style('transition-duration', preferences.transitions ? 120 : 0)
    .selector('edge').style('transition-property', preferences.transitions ? 'opacity, width, line-color, target-arrow-color' : 'none')
    .style('transition-duration', preferences.transitions ? 120 : 0)
    // These selectors must follow the generic transition rules: Cytoscape's
    // stylesheet cascade is order-based, so an earlier structure-specific rule
    // would be overwritten when renderer preferences are applied.
    .selector('node.structure-source-node, node.structure-source-junction')
    .style('transition-property', 'none')
    .style('transition-duration', 0)
    .selector('edge.structure-source-edge')
    .style('transition-property', 'none')
    .style('transition-duration', 0)
    .update();
  cy.resize();
  cy.forceRender();
}
