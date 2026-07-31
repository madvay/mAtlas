declare const __GRAPH_DATA_URL__: string;
declare const __SHARE_CODEC_URL__: string;

interface AtlasRecoveryController {
  readonly parameterName: string;
  reload(): boolean;
  retry(): void;
  ready(): void;
  isReloading(): boolean;
}


interface AtlasSvgExportResult {
  svg: string;
  nodeCount: number;
  edgeCount: number;
  width: number;
  height: number;
}

interface AtlasStaticSvgExporter {
  serializeVisible(): AtlasSvgExportResult | null;
  serializeFieldDomainStructure(fieldId: string): AtlasSvgExportResult | null;
  serializePrimaryDomain(domainId: string): AtlasSvgExportResult | null;
}

interface Window {
  cy?: import('cytoscape').Core;
  __atlasRecovery?: AtlasRecoveryController;
  __atlasStaticSvgExporter?: AtlasStaticSvgExporter;
}

declare const __VIEWS_DATA_URL__: string;
