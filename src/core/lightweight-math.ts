/** A deliberately dependency-free, approximate LaTeX-to-Unicode renderer for compact labels. */
const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: '𝛼', beta: '𝛽', gamma: '𝛾', delta: '𝛿', epsilon: '𝜀', varepsilon: '𝜖', zeta: '𝜁', eta: '𝜂',
  theta: '𝜃', vartheta: '𝜗', iota: '𝜄', kappa: '𝜅', lambda: '𝜆', mu: '𝜇', nu: '𝜈', xi: '𝜉', pi: '𝜋',
  rho: '𝜌', sigma: '𝜎', tau: '𝜏', upsilon: '𝜐', phi: '𝜙', varphi: '𝜑', chi: '𝜒', psi: '𝜓', omega: '𝜔',
  Gamma: '𝛤', Delta: '𝛥', Theta: '𝛩', Lambda: '𝛬', Xi: '𝛯', Pi: '𝛱', Sigma: '𝛴', Phi: '𝛷', Psi: '𝛹', Omega: '𝛺',
  aleph: 'ℵ', beth: 'ℶ', ell: 'ℓ', hbar: 'ℏ', imath: 'ı', jmath: 'ȷ', Re: 'ℜ', Im: 'ℑ',
  infty: '∞', partial: '∂', nabla: '∇', pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', approx: '≈', sim: '∼', simeq: '≃', cong: '≅', equiv: '≡',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  emptyset: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', to: '→', rightarrow: '→',
  leftarrow: '←', leftrightarrow: '↔', mapsto: '↦', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  implies: '⇒', iff: '⇔', sum: '∑', prod: '∏', coprod: '∐', int: '∫', oint: '∮', sqrt: '√', angle: '∠'
};

const BLACKBOARD: Readonly<Record<string, string>> = {
  C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ'
};
const FRAKTUR: Readonly<Record<string, string>> = { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ', c: '𝔠' };
const CALLIGRAPHIC: Readonly<Record<string, string>> = { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', P: '℘', R: 'ℛ' };
const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', i: 'ⁱ', n: 'ⁿ'
};
const SUBSCRIPTS: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ',
  l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ'
};

function script(value: string, marker: '^' | '_'): string {
  const table = marker === '^' ? SUPERSCRIPTS : SUBSCRIPTS;
  const characters = [...value];
  if (!characters.every((character) => table[character] !== undefined)) return `${marker}(${value})`;
  return characters.map((character) => table[character]).join('');
}

function styled(command: string, value: string): string {
  const table = command === 'mathbb' ? BLACKBOARD : command === 'mathfrak' ? FRAKTUR : CALLIGRAPHIC;
  return [...value].map((character) => table[character] ?? character).join('');
}

function italicLetter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d434 + code - 0x41);
  if (code === 0x68) return 'ℎ';
  if (code >= 0x61 && code <= 0x67) return String.fromCodePoint(0x1d44e + code - 0x61);
  if (code >= 0x69 && code <= 0x7a) return String.fromCodePoint(0x1d456 + code - 0x69);
  return character;
}

/** Convert the common, label-safe subset of LaTeX to readable Unicode without HTML overlays. */
export function lightweightLatexToUnicode(latex: string): string {
  let value = latex.trim();
  const upright: string[] = [];
  value = value.replace(/\\(?:mathrm|mathbf|mathsf|mathtt|text|operatorname)\s*\{([^{}]*)\}/g, (_match, body: string) => {
    upright.push(body);
    return String.fromCodePoint(0xe000 + upright.length - 1);
  });
  // Resolve nested simple fractions/roots first; repeated passes cover nesting without a full TeX parser.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = value
      .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
      .replace(/\\sqrt(?:\[([^\]]+)\])?\s*\{([^{}]+)\}/g, (_match, root: string, body: string) => root ? `√[${root}](${body})` : `√(${body})`);
    if (next === value) break;
    value = next;
  }
  value = value
    .replace(/\\(mathbb|mathfrak|mathcal)\s*\{?([A-Za-z]+)\}?/g, (_match, command: string, body: string) => styled(command, body))
    .replace(/\\mathit\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (match, name: string) => SYMBOLS[name] ?? match.slice(1))
    .replace(/\^\{([^{}]+)\}|\^([^\s])/gu, (_match, group: string, single: string) => script(group ?? single, '^'))
    .replace(/_\{([^{}]+)\}|_([^\s])/gu, (_match, group: string, single: string) => script(group ?? single, '_'))
    .replace(/\\(?:,|;|:|!|quad|qquad)/g, ' ')
    .replace(/\\([{}_|])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ')
    .replace(/\\/g, '')
    .replace(/[A-Za-z]/g, italicLetter)
    .replace(/[\uE000-\uF8FF]/g, (placeholder) => upright[(placeholder.codePointAt(0) ?? 0) - 0xe000] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

export function replaceInlineLatexWithUnicode(text: string): string {
  return text.replace(/\$([^$\n]+?)\$/g, (_match, latex: string) => lightweightLatexToUnicode(latex));
}
