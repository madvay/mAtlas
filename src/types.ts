export type NodeKind = 'structure' | 'junction';
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type PrerequisiteTraversal = 'incoming' | 'outgoing' | 'both';
export type LayoutName = 'atlas' | 'breadthfirst';
export type CrossFieldVisibility = 'contextual' | 'all' | 'hidden';
export type HistoryMode = 'push' | 'replace' | null;
export type MathText = string;


export type ShareCodecSlot =
  | { id: string; retired?: never }
  | { id?: never; retired: string };

export interface ShareCodecConfig {
  formatVersion: number;
  fields: ShareCodecSlot[];
  domains: ShareCodecSlot[];
  edgeTypes: ShareCodecSlot[];
}

export interface GraphMeta {
  title: string;
  version: string;
  description: string;
  direction: string;
  scope: string;
  defaultField?: string;
  edgeTypeOrder?: string[];
  fieldOrder?: string[];
  domainOrder?: string[];
  [key: string]: unknown;
}

export interface FieldDefinition {
  label: string;
  shortLabel?: string;
  color: string;
  order: number;
  path: string;
  description: MathText;
}

export interface DomainDefinition {
  label: string;
  color: string;
  order: number;
  field: string;
}

export interface EdgeTypeDefinition {
  label: string;
  short: string;
  description: MathText;
  prerequisiteTraversal: PrerequisiteTraversal;
  color: string;
  endpointLabels: {
    source: string;
    target: string;
  };
  lineStyle?: LineStyle;
  activeInDataset?: boolean;
  defaultVisible?: boolean;
}

export interface SourceDefinition {
  label: string;
  title: string;
  url: string;
  kind: string;
}

export interface CombinationDefinition {
  inputs: string[];
  compatibility: MathText;
  output: string;
}

export interface DetailSection {
  title: string;
  body?: MathText;
  items?: MathText[];
}

export interface GraphNode {
  id: string;
  label: string;
  primaryField?: string;
  fields?: string[];
  primaryDomain: string;
  domains: string[];
  level: number;
  kind: NodeKind;
  conceptType?: string;
  scale?: string;
  status?: string;
  summary: MathText;
  sections?: DetailSection[];
  root?: boolean;
  carriers?: MathText[];
  data?: MathText[];
  axioms?: MathText[];
  induces?: MathText[];
  notes?: MathText;
  citations: string[];
  combination?: CombinationDefinition;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  detail: MathText;
  citations: string[];
  overview?: boolean;
  synthetic?: boolean;
  junctionId?: string;
}

export interface GraphData {
  meta: GraphMeta;
  fields: Record<string, FieldDefinition>;
  domains: Record<string, DomainDefinition>;
  edgeTypes: Record<string, EdgeTypeDefinition>;
  citationLegend?: Record<string, string>;
  sources: Record<string, SourceDefinition>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AppState {
  selectedFields: Set<string>;
  selectedDomains: Set<string>;
  selectedEdgeTypes: Set<string>;
  excludedFields: Set<string>;
  excludedDomains: Set<string>;
  prohibitedDomains: Set<string>;
  crossFieldVisibility: CrossFieldVisibility;
  showPrimaryOnly: boolean;
  hideIsolates: boolean;
  showEdgeLabels: boolean;
  showJunctions: boolean;
  edgeZoomActivation: boolean;
  hidePrerequisites: boolean;
  neighborhoodActive: boolean;
  neighborhoodElementId: string | null;
  layout: LayoutName;
  searchQuery: string;
  filtersOpen: boolean;
  detailsOpen: boolean;
}

export interface Preferences {
  version: 1;
  highResolution: boolean;
  transitions: boolean;
  motionBlur: boolean;
  formulaeInGraph: boolean;
  indicateOtherDomains: boolean;
  hideEdgesWhileMoving: boolean;
  allowNodeMovement: boolean;
  dimPrerequisites: boolean;
  highlightPrerequisites: boolean;
  experimentalFeatures: boolean;
}

export interface UrlUiState {
  fields?: string[];
  domains?: string[];
  edgeTypes?: string[];
  excludedFields?: string[];
  excludedDomains?: string[];
  prohibitedDomains?: string[];
  crossFieldVisibility?: CrossFieldVisibility;
  showPrimaryOnly?: boolean;
  hideIsolates?: boolean;
  edgeLabels?: boolean;
  junctions?: boolean;
  edgeZoomActivation?: boolean;
  hidePrerequisites?: boolean;
  layout?: LayoutName;
}

export interface AtlasViewImage {
  src: string;
  alt: string;
}

export interface AtlasViewSettings {
  fields?: string[];
  domains?: string[];
  edgeTypes: string[];
  excludedFields?: string[];
  excludedDomains?: string[];
  prohibitedDomains?: string[];
  crossFieldVisibility: CrossFieldVisibility;
  showPrimaryOnly?: boolean;
  hideIsolates?: boolean;
  edgeLabels: boolean;
  junctions: boolean;
  edgeZoomActivation: boolean;
  hidePrerequisites?: boolean;
  layout: LayoutName;
}

export interface AtlasView {
  id: string;
  title: string;
  summary: string;
  narrative: string;
  tags: string[];
  featured?: boolean;
  coreNodes?: string[];
  nodeSequence?: string[];
  image?: AtlasViewImage;
  settings: AtlasViewSettings;
}

export interface AtlasViewsData {
  version: 1;
  views: AtlasView[];
}

export interface LabelMetrics {
  targetScreenPx: number;
  minGraphPx: number;
  maxGraphPx: number;
  maxWidth: number;
  maxHeight: number;
}

export interface SelectionTarget {
  kind: 'node' | 'edge';
  id: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface RelationEntry {
  nodeId: string;
  edgeId: string;
  edgeLabel: string;
  direction: 'source' | 'target';
}

export interface RelationGroup {
  label: string;
  relations: RelationEntry[];
}
