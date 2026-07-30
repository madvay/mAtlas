import { explicitMathErrors, findUnmarkedMath } from '../../math-markup.mjs';
import { arrayOrEmpty, entriesOrEmpty } from '../validation-helpers.mjs';

export const name = 'editorial';

function validateNoAsciiControls(value, path, errors) {
  if (typeof value === 'string') {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
      errors.push(`${path} contains an ASCII control character; this usually indicates a corrupted escape sequence.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoAsciiControls(item, `${path}[${index}]`, errors));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) validateNoAsciiControls(item, `${path}.${key}`, errors);
  }
}

function validateMathText(value, path, errors) {
  if (typeof value !== 'string') return;
  for (const error of explicitMathErrors(value)) errors.push(`${path} ${error}.`);
  for (const finding of findUnmarkedMath(value)) {
    errors.push(`${path} contains unmarked math candidate ${JSON.stringify(finding.source)}; use explicit $...$ LaTeX.`);
  }
}

export function validate(context) {
  const { graph, viewsData, fields, edgeTypes, sources, nodes, edges, views } = context;
  const errors = [];
  validateNoAsciiControls(graph, 'graph', errors);
  validateNoAsciiControls(viewsData, 'views', errors);

  for (const [id, field] of fields) validateMathText(field?.description, `graph.fields.${id}.description`, errors);
  for (const [id, edgeType] of edgeTypes) validateMathText(edgeType?.description, `graph.edgeTypes.${id}.description`, errors);
  for (const [index, node] of nodes.entries()) {
    const path = `graph.nodes[${index}]`;
    validateMathText(node?.summary, `${path}.summary`, errors);
    for (const key of ['carriers', 'data', 'axioms', 'induces']) {
      for (const [itemIndex, item] of arrayOrEmpty(node?.[key]).entries()) validateMathText(item, `${path}.${key}[${itemIndex}]`, errors);
    }
    validateMathText(node?.notes, `${path}.notes`, errors);
    validateMathText(node?.combination?.compatibility, `${path}.combination.compatibility`, errors);
    for (const [sectionIndex, section] of arrayOrEmpty(node?.sections).entries()) {
      validateMathText(section?.body, `${path}.sections[${sectionIndex}].body`, errors);
      for (const [itemIndex, item] of arrayOrEmpty(section?.items).entries()) validateMathText(item, `${path}.sections[${sectionIndex}].items[${itemIndex}]`, errors);
    }
    if (!arrayOrEmpty(node?.citations).length) errors.push(`Node ${String(node?.id)} must have at least one citation.`);
    const primaryField = node?.primaryField ?? graph?.domains?.[node?.primaryDomain]?.field;
    if (primaryField === 'physics') {
      const citedSources = arrayOrEmpty(node?.citations).map((id) => graph?.sources?.[id]).filter(Boolean);
      if (!citedSources.some((source) => typeof source?.url === 'string' && source.url.includes('wikipedia.org'))) {
        errors.push(`Physics node ${String(node?.id)} must cite a Wikipedia overview for navigation.`);
      }
      if (!citedSources.some((source) => typeof source?.url === 'string' && !source.url.includes('wikipedia.org') && !source.url.includes('ncatlab.org'))) {
        errors.push(`Physics node ${String(node?.id)} must cite at least one authoritative source beyond Wikipedia and nLab.`);
      }
    }
  }

  for (const [index, edge] of edges.entries()) {
    validateMathText(edge?.detail, `graph.edges[${index}].detail`, errors);
    if (!arrayOrEmpty(edge?.citations).length) errors.push(`Edge ${String(edge?.id)} must have at least one citation.`);
  }

  const sourceIdsByUrl = new Map();
  for (const [id, source] of sources) {
    if (typeof source?.label === 'string' && !source.label.includes(' — ')) {
      errors.push(`graph.sources.${id}.label must use the normalized “Publisher — title” form.`);
    }
    if (typeof source?.url === 'string') {
      try {
        const parsed = new URL(source.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(`graph.sources.${id}.url must use http or https.`);
      } catch {
        errors.push(`graph.sources.${id}.url is not a valid absolute URL.`);
      }
      if (sourceIdsByUrl.has(source.url)) errors.push(`Sources ${sourceIdsByUrl.get(source.url)} and ${id} duplicate the same URL.`);
      else sourceIdsByUrl.set(source.url, id);
    }
  }

  let featuredViewCount = 0;
  for (const [index, view] of views.entries()) {
    const path = `views.views[${index}]`;
    if (typeof view?.id === 'string' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(view.id)) errors.push(`${path}.id must be a lowercase URL slug.`);
    if (view?.featured === true) featuredViewCount += 1;
    if (view?.image?.src !== undefined) {
      try {
        const imageUrl = new URL(view.image.src, 'https://atlas.madvay.com/');
        if (!['http:', 'https:'].includes(imageUrl.protocol)) errors.push(`${path}.image.src must resolve to an HTTP(S) URL.`);
      } catch {
        errors.push(`${path}.image.src is not a valid URL or root-relative path.`);
      }
    }
  }
  if (featuredViewCount === 0) errors.push('At least one story or view must be featured.');

  for (const [id, legend] of entriesOrEmpty(graph?.citationLegend)) {
    if (typeof legend !== 'string' || legend.length === 0) errors.push(`graph.citationLegend.${id} must be a non-empty string.`);
  }

  return errors;
}
