import { arrayOrEmpty } from '../validation-helpers.mjs';

export const name = 'renderer-compatibility';

export function validate(context) {
  const { graph, fields, domains, edgeTypes, nodes, edges, views } = context;
  const errors = [];
  const allowedKinds = new Set(['structure', 'junction']);
  const allowedLineStyles = new Set(['solid', 'dashed', 'dotted']);
  const allowedLayouts = new Set(['atlas', 'breadthfirst']);
  const allowedCrossField = new Set(['contextual', 'all', 'hidden']);

  for (const [id, field] of fields) {
    if (!/^#[0-9a-f]{6}$/i.test(field?.color ?? '')) errors.push(`graph.fields.${id}.color must be a six-digit hex color.`);
  }
  for (const [id, domain] of domains) {
    if (!/^#[0-9a-f]{6}$/i.test(domain?.color ?? '')) errors.push(`graph.domains.${id}.color must be a six-digit hex color.`);
  }
  for (const [id, edgeType] of edgeTypes) {
    if (!/^#[0-9a-f]{6}$/i.test(edgeType?.color ?? '')) errors.push(`graph.edgeTypes.${id}.color must be a six-digit hex color.`);
    if (edgeType?.lineStyle !== undefined && !allowedLineStyles.has(edgeType.lineStyle)) errors.push(`graph.edgeTypes.${id}.lineStyle is invalid.`);
  }

  for (const [index, node] of nodes.entries()) {
    const path = `graph.nodes[${index}]`;
    if (!allowedKinds.has(node?.kind)) errors.push(`${path}.kind must be structure or junction.`);
    if (node?.kind === 'junction' && !node?.combination) errors.push(`${path}.combination is required for junction nodes.`);
    if (node?.kind !== 'junction' && node?.combination !== undefined) errors.push(`${path}.combination is only valid for junction nodes.`);
    const primaryField = node?.primaryField ?? graph?.domains?.[node?.primaryDomain]?.field;
    if (node?.kind === 'structure' && primaryField !== 'mathematics' && !node?.conceptType) {
      errors.push(`${path}.conceptType is required outside the legacy mathematics field.`);
    }
  }

  for (const [index, edge] of edges.entries()) {
    if (edge?.overview !== undefined && typeof edge.overview !== 'boolean') errors.push(`graph.edges[${index}].overview must be a boolean.`);
  }

  for (const [index, view] of views.entries()) {
    const path = `views.views[${index}]`;
    const settings = view?.settings ?? {};
    if (!allowedCrossField.has(settings.crossFieldVisibility)) errors.push(`${path}.settings.crossFieldVisibility is invalid.`);
    if (!allowedLayouts.has(settings.layout)) errors.push(`${path}.settings.layout is invalid.`);
    for (const key of ['edgeLabels', 'junctions', 'edgeZoomActivation']) {
      if (typeof settings[key] !== 'boolean') errors.push(`${path}.settings.${key} must be a boolean.`);
    }
    if (settings.hidePrerequisites !== undefined && typeof settings.hidePrerequisites !== 'boolean') errors.push(`${path}.settings.hidePrerequisites must be a boolean.`);
    if (arrayOrEmpty(view?.nodeSequence).length < 2) errors.push(`${path}.nodeSequence must contain at least two concepts for guided navigation.`);
  }

  return errors;
}
