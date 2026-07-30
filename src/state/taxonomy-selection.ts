export interface TaxonomySelection {
  fields: Set<string>;
  domains: Set<string>;
}

export interface TaxonomySelectionContext {
  fieldOrder: readonly string[];
  domainOrder: readonly string[];
  fieldForDomain: (domainId: string) => string;
}

export type DomainSuppression = 'included' | 'excluded' | 'prohibited';

export function domainSuppression(
  domainId: string,
  excludedDomains: ReadonlySet<string>,
  prohibitedDomains: ReadonlySet<string>
): DomainSuppression {
  if (prohibitedDomains.has(domainId)) return 'prohibited';
  if (excludedDomains.has(domainId)) return 'excluded';
  return 'included';
}

export function cycleDomainSuppression(
  domainId: string,
  excludedDomains: Set<string>,
  prohibitedDomains: Set<string>
): DomainSuppression {
  const current = domainSuppression(domainId, excludedDomains, prohibitedDomains);
  excludedDomains.delete(domainId);
  prohibitedDomains.delete(domainId);
  if (current === 'included') {
    excludedDomains.add(domainId);
    return 'excluded';
  }
  if (current === 'excluded') {
    prohibitedDomains.add(domainId);
    return 'prohibited';
  }
  return 'included';
}

export function selectExclusiveField(
  currentFields: ReadonlySet<string>,
  currentDomains: ReadonlySet<string>,
  fieldId: string,
  context: TaxonomySelectionContext
): TaxonomySelection {
  const fieldDomains = context.domainOrder.filter((domainId) => context.fieldForDomain(domainId) === fieldId);
  const isSingleField = currentFields.size === 1
    && currentFields.has(fieldId)
    && fieldDomains.length === currentDomains.size
    && fieldDomains.every((domainId) => currentDomains.has(domainId));
  return {
    fields: new Set(isSingleField ? context.fieldOrder.filter((id) => id !== fieldId) : [fieldId]),
    domains: new Set(isSingleField
      ? context.domainOrder.filter((domainId) => !fieldDomains.includes(domainId))
      : fieldDomains)
  };
}

export function selectExclusiveDomain(
  currentDomains: ReadonlySet<string>,
  domainId: string,
  context: TaxonomySelectionContext
): TaxonomySelection {
  const isSingleDomain = currentDomains.size === 1 && currentDomains.has(domainId);
  const domains = isSingleDomain ? context.domainOrder.filter((id) => id !== domainId) : [domainId];
  return {
    fields: new Set(domains.map((id) => context.fieldForDomain(id))),
    domains: new Set(domains)
  };
}

export function selectExclusiveEdgeType(
  currentEdgeTypes: ReadonlySet<string>,
  edgeTypeId: string,
  activeEdgeTypes: readonly string[]
): Set<string> {
  const isSingleEdgeType = currentEdgeTypes.size === 1 && currentEdgeTypes.has(edgeTypeId);
  return new Set(isSingleEdgeType
    ? activeEdgeTypes.filter((id) => id !== edgeTypeId)
    : [edgeTypeId]);
}
