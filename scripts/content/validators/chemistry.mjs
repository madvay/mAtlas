import { arrayOrEmpty } from '../validation-helpers.mjs';

export const name = 'chemistry';

export const CHEMISTRY_DOMAINS = Object.freeze([
  'chemical-foundations',
  'atomic-structure-periodicity',
  'molecular-structure-bonding',
  'quantum-chemistry-spectroscopy',
  'chemical-thermodynamics-equilibrium',
  'solutions-interfaces',
  'chemical-kinetics-dynamics',
  'inorganic-coordination-chemistry',
  'organic-chemistry',
  'analytical-chemistry',
  'electrochemistry',
  'radiochemistry',
  'materials-polymer-chemistry',
  'biochemistry-chemical-biology',
  'environmental-atmospheric-chemistry',
  'industrial-process-chemistry',
  'chemistry-experiments-evidence'
]);

const EVIDENCE_DOMAIN = 'chemistry-experiments-evidence';
const SUBSTANTIVE_DOMAINS = CHEMISTRY_DOMAINS.filter((id) => id !== EVIDENCE_DOMAIN);

const LEVEL_RANGES = Object.freeze({
  'chemical-foundations': [19, 27],
  'atomic-structure-periodicity': [25, 31],
  'molecular-structure-bonding': [31, 36],
  'quantum-chemistry-spectroscopy': [30, 41],
  'chemical-thermodynamics-equilibrium': [24, 33],
  'solutions-interfaces': [26, 34],
  'chemical-kinetics-dynamics': [27, 35],
  'inorganic-coordination-chemistry': [32, 40],
  'organic-chemistry': [32, 41],
  'analytical-chemistry': [26, 37],
  electrochemistry: [29, 39],
  radiochemistry: [27, 38],
  'materials-polymer-chemistry': [36, 45],
  'biochemistry-chemical-biology': [35, 46],
  'environmental-atmospheric-chemistry': [36, 41],
  'industrial-process-chemistry': [37, 42]
});

const REQUIRED_PHYSICS_PRIMARY_MEMBERSHIPS = Object.freeze({
  chemical_element: 'atomic-structure-periodicity',
  atom: 'atomic-structure-periodicity',
  ion: 'solutions-interfaces',
  anion: 'electrochemistry',
  cation: 'electrochemistry',
  molecule: 'molecular-structure-bonding',
  chemical_bond: 'molecular-structure-bonding',
  isotope: 'radiochemistry',
  radioactive_decay: 'radiochemistry',
  nuclear_spin: 'quantum-chemistry-spectroscopy',
  electromagnetic_radiation: 'quantum-chemistry-spectroscopy',
  quantum_mechanics: 'quantum-chemistry-spectroscopy',
  schrodinger_equation: 'quantum-chemistry-spectroscopy',
  thermodynamic_system: 'chemical-thermodynamics-equilibrium',
  thermodynamic_equilibrium: 'chemical-thermodynamics-equilibrium',
  phase_transition: 'materials-polymer-chemistry',
  crystalline_solid: 'materials-polymer-chemistry',
  semiconductor: 'materials-polymer-chemistry',
  electron: 'atomic-structure-periodicity',
  photon: 'quantum-chemistry-spectroscopy',
  atomic_spectrum: 'analytical-chemistry',
  density_functional_theory: 'quantum-chemistry-spectroscopy',
  hartree_fock_method: 'quantum-chemistry-spectroscopy',
  configuration_interaction_method: 'quantum-chemistry-spectroscopy',
  coupled_cluster_method: 'quantum-chemistry-spectroscopy',
  moseley_xray_spectroscopy: EVIDENCE_DOMAIN,
  aston_mass_spectrograph_measurements: EVIDENCE_DOMAIN
});

const REQUIRED_GLOBAL_LEVEL_ALIGNMENTS = Object.freeze([
  { chemistryId: 'periodic_table', physicsId: 'chemical_element', maximumDifference: 3 },
  { chemistryId: 'molecular_structure', physicsId: 'molecule', maximumDifference: 4 }
]);

function primaryField(node, graph) {
  return node?.primaryField ?? graph?.domains?.[node?.primaryDomain]?.field;
}

function nodeFields(node, graph) {
  if (Array.isArray(node?.fields)) return node.fields;
  return [...new Set(arrayOrEmpty(node?.domains).map((id) => graph?.domains?.[id]?.field).filter(Boolean))];
}

function citedSources(item, graph) {
  return arrayOrEmpty(item?.citations).map((id) => graph?.sources?.[id]).filter(Boolean);
}

function hasWikipedia(sources) {
  return sources.some((source) => typeof source?.url === 'string' && source.url.includes('wikipedia.org'));
}

function hasAuthority(sources) {
  return sources.some((source) => typeof source?.url === 'string'
    && !source.url.includes('wikipedia.org')
    && !source.url.includes('ncatlab.org'));
}

export function validate(context) {
  const { graph, nodes, edges, nodeById } = context;
  const errors = [];
  const domainOrder = arrayOrEmpty(graph?.meta?.domainOrder);
  const chemistryOrder = domainOrder.filter((id) => CHEMISTRY_DOMAINS.includes(id));
  if (JSON.stringify(chemistryOrder) !== JSON.stringify(CHEMISTRY_DOMAINS)) {
    errors.push(`Chemistry domains must preserve the structural order: ${CHEMISTRY_DOMAINS.join(', ')}.`);
  }
  if (graph?.fields?.chemistry?.order !== 2 || graph?.fields?.chemistry?.path !== 'chemistry') {
    errors.push('Chemistry must remain field order 2 with the public path chemistry.');
  }
  for (const [index, domainId] of CHEMISTRY_DOMAINS.entries()) {
    const domain = graph?.domains?.[domainId];
    if (!domain) {
      errors.push(`Missing Chemistry domain ${domainId}.`);
      continue;
    }
    if (domain.field !== 'chemistry') errors.push(`Domain ${domainId} must belong to Chemistry.`);
    if (domain.order !== 200 + index) errors.push(`Domain ${domainId} must retain order ${200 + index}.`);
  }

  const chemistryPrimary = nodes.filter((node) => primaryField(node, graph) === 'chemistry');
  const chemistryMembers = nodes.filter((node) => nodeFields(node, graph).includes('chemistry'));
  if (chemistryPrimary.length < 320) errors.push(`Chemistry must contain at least 320 primary concepts; found ${chemistryPrimary.length}.`);
  if (chemistryMembers.length < 390) errors.push(`Chemistry must include at least 390 primary or shared concepts; found ${chemistryMembers.length}.`);

  for (const node of chemistryPrimary) {
    if (!nodeFields(node, graph).includes('chemistry')) errors.push(`Chemistry node ${node.id} omits Chemistry from fields.`);
    if (!arrayOrEmpty(node?.domains).includes(node.primaryDomain)) errors.push(`Chemistry node ${node.id} omits its primary domain.`);
    if (node.primaryDomain === EVIDENCE_DOMAIN) errors.push(`Evidence node ${node.id} must retain a substantive primary domain.`);
    const range = LEVEL_RANGES[node.primaryDomain];
    if (range && (!Number.isFinite(node.level) || node.level < range[0] || node.level > range[1])) {
      errors.push(`Chemistry node ${node.id} level ${String(node.level)} is outside ${node.primaryDomain}'s rationalized range ${range[0]}–${range[1]}.`);
    }
    const sources = citedSources(node, graph);
    if (arrayOrEmpty(node?.citations).length < 2) errors.push(`Chemistry node ${node.id} must cite multiple sources.`);
    if (!hasWikipedia(sources)) errors.push(`Chemistry node ${node.id} must cite a Wikipedia navigation source.`);
    if (!hasAuthority(sources)) errors.push(`Chemistry node ${node.id} must cite an authoritative source beyond Wikipedia and nLab.`);
  }

  for (const domainId of SUBSTANTIVE_DOMAINS) {
    const domainNodes = chemistryPrimary.filter((node) => node.primaryDomain === domainId);
    if (domainNodes.length < 12) errors.push(`Chemistry domain ${domainId} must contain at least 12 primary concepts; found ${domainNodes.length}.`);
  }

  const chemistrySourceEdges = edges.filter((item) => primaryField(nodeById.get(item?.source), graph) === 'chemistry');
  const chemistryInternalEdges = chemistrySourceEdges.filter((item) => nodeFields(nodeById.get(item?.target), graph).includes('chemistry'));
  const crossDomainEdges = chemistryInternalEdges.filter((item) => nodeById.get(item.source)?.primaryDomain !== nodeById.get(item.target)?.primaryDomain);
  const crossFieldEdges = chemistrySourceEdges.filter((item) => primaryField(nodeById.get(item?.target), graph) !== 'chemistry');
  if (chemistrySourceEdges.length < 475) errors.push(`Chemistry must author at least 475 outgoing relations; found ${chemistrySourceEdges.length}.`);
  if (crossDomainEdges.length < 190) errors.push(`Chemistry must contain at least 190 cross-domain relations; found ${crossDomainEdges.length}.`);
  if (crossFieldEdges.length < 30) errors.push(`Chemistry must contain at least 30 cross-field relations; found ${crossFieldEdges.length}.`);

  for (const edge of chemistrySourceEdges) {
    const sources = citedSources(edge, graph);
    if (arrayOrEmpty(edge?.citations).length < 2) errors.push(`Chemistry edge ${edge.id} must cite multiple sources.`);
    if (!hasWikipedia(sources)) errors.push(`Chemistry edge ${edge.id} must cite a Wikipedia navigation source.`);
    if (!hasAuthority(sources)) errors.push(`Chemistry edge ${edge.id} must cite an authoritative source beyond Wikipedia and nLab.`);
  }
  for (const domainId of SUBSTANTIVE_DOMAINS) {
    const outbound = crossDomainEdges.filter((edge) => nodeById.get(edge.source)?.primaryDomain === domainId);
    if (outbound.length < 3) errors.push(`Chemistry domain ${domainId} must author at least three cross-domain relations; found ${outbound.length}.`);
  }

  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  const isolates = chemistryPrimary.filter((node) => (degrees.get(node.id) ?? 0) === 0);
  if (isolates.length) errors.push(`Chemistry contains isolated primary concepts: ${isolates.map((node) => node.id).join(', ')}.`);
  const substantiveNodes = chemistryPrimary.filter((node) => !arrayOrEmpty(node.domains).includes(EVIDENCE_DOMAIN));
  const multiplyLinked = substantiveNodes.filter((node) => (degrees.get(node.id) ?? 0) >= 2).length;
  if (multiplyLinked / Math.max(1, substantiveNodes.length) < 0.8) {
    errors.push(`At least 80% of substantive Chemistry concepts must have two or more incident relations; found ${multiplyLinked}/${substantiveNodes.length}.`);
  }

  const evidenceNodes = chemistryMembers.filter((node) => arrayOrEmpty(node?.domains).includes(EVIDENCE_DOMAIN));
  if (evidenceNodes.length < 36) errors.push(`Chemistry must retain at least 36 evidence-program concepts; found ${evidenceNodes.length}.`);
  const evidenceIds = new Set(evidenceNodes.map((node) => node.id));
  for (const node of evidenceNodes) {
    if (node.primaryDomain === EVIDENCE_DOMAIN) errors.push(`Evidence concept ${node.id} must be primary in a substantive domain.`);
    const evidenceRelations = edges.filter((edge) => (edge.source === node.id || edge.target === node.id)
      && ['historically-motivated', 'experimentally-verified-by'].includes(edge.type));
    if (!evidenceRelations.length) errors.push(`Evidence concept ${node.id} has no historical-motivation or experimental-verification relation.`);
  }
  for (const edge of edges) {
    if (edge.type === 'historically-motivated' && (evidenceIds.has(edge.source) || evidenceIds.has(edge.target))) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!evidenceIds.has(edge.source)) errors.push(`Historical edge ${edge.id} must point from its evidence concept.`);
      if (Number.isFinite(source?.level) && Number.isFinite(target?.level) && source.level >= target.level) {
        errors.push(`Motivating experiment edge ${edge.id} must rise from a lower level (${source.level}) to its motivated concept (${target.level}).`);
      }
    }
    if (edge.type === 'experimentally-verified-by' && (evidenceIds.has(edge.source) || evidenceIds.has(edge.target))) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!evidenceIds.has(edge.target)) errors.push(`Verification edge ${edge.id} must point to its evidence concept.`);
      if (Number.isFinite(source?.level) && Number.isFinite(target?.level) && target.level <= source.level) {
        errors.push(`Verifying experiment edge ${edge.id} must point to a higher-level experiment (${target.level}) than its claim (${source.level}).`);
      }
    }
  }

  const physicsPrimaryChemistryMembers = chemistryMembers.filter((node) => primaryField(node, graph) === 'physics');
  if (physicsPrimaryChemistryMembers.length < 70) {
    errors.push(`At least 70 shared Physics-primary concepts must retain Chemistry memberships; found ${physicsPrimaryChemistryMembers.length}.`);
  }
  for (const [nodeId, domainId] of Object.entries(REQUIRED_PHYSICS_PRIMARY_MEMBERSHIPS)) {
    const node = nodeById.get(nodeId);
    if (!node) {
      errors.push(`Missing required Physics–Chemistry boundary concept ${nodeId}.`);
      continue;
    }
    if (primaryField(node, graph) !== 'physics') errors.push(`Boundary concept ${nodeId} must remain Physics-primary.`);
    if (!nodeFields(node, graph).includes('chemistry')) errors.push(`Boundary concept ${nodeId} must include Chemistry membership.`);
    if (!arrayOrEmpty(node.domains).includes(domainId)) errors.push(`Boundary concept ${nodeId} must include Chemistry domain ${domainId}.`);
  }
  for (const alignment of REQUIRED_GLOBAL_LEVEL_ALIGNMENTS) {
    const chemistryNode = nodeById.get(alignment.chemistryId);
    const physicsNode = nodeById.get(alignment.physicsId);
    if (!chemistryNode || !physicsNode) {
      errors.push(`Missing required cross-field level alignment ${alignment.chemistryId} ↔ ${alignment.physicsId}.`);
      continue;
    }
    if (Number.isFinite(chemistryNode.level) && Number.isFinite(physicsNode.level)
      && Math.abs(chemistryNode.level - physicsNode.level) > alignment.maximumDifference) {
      errors.push(`Cross-field level alignment ${alignment.chemistryId} (${chemistryNode.level}) ↔ ${alignment.physicsId} (${physicsNode.level}) exceeds ${alignment.maximumDifference} levels.`);
    }
  }

  return errors;
}
