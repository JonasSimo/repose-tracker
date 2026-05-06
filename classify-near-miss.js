/**
 * Near Miss auto-classifier
 * ─────────────────────────────────────────────────────────────────────────
 * Pure JS module — no dependencies. Works in:
 *   • Browser (RepNet near-miss form, pre-fills categories live as user types)
 *   • Azure Function (Power Automate calls HTTP endpoint before writing row)
 *   • Office Script (Power Automate "Run script" action, sets the two
 *     category columns directly in the Excel log)
 *
 * Returns:
 *   {
 *     nearMissCategory: 'At-Risk Condition' | 'At-Risk Behavior' | 'Positive Observation',
 *     observationCategory: <one of the 19 child categories>,
 *     confidence: 0..1,
 *     matched: [keyword, …]   // for debugging / "why did it pick this?"
 *   }
 *
 * Built from analysing 140 closed records in Near Miss Log.xlsx.
 */

// ── Child-category keyword bags ────────────────────────────────────────────
// Each bag has weighted keywords. A "strong" hit (weight 2) is enough on its
// own; a "weak" hit (weight 1) needs another to overcome a competing strong.
// Keywords use simple stems so 'leak' matches 'leaking', 'leakage', etc.
// Order matters only for ties — the engine prefers the first-listed bag.
const CHILD_RULES = [
  { cat: 'Positive Observation', strong: [
    'well done', 'good job', 'good practice', 'great spot', 'nice catch',
    'noticed correctly', 'positive observation', 'safe behaviour from'
  ], weak: [ 'praise', 'thanks to', 'excellent' ]},

  { cat: 'Bypassing or Removing Safety Devices', strong: [
    'bypass', 'guard removed', 'guard disabled', 'cable-tie', 'cable tie',
    'tied open', 'interlock', 'safety device disabled', 'override switch'
  ], weak: [ 'jammed open', 'wedged' ]},

  { cat: 'Sharp Edges / Protrusions', strong: [
    'staple', 'mill staple', 'protrud', 'sticking out', 'sticking up',
    'sticking through', 'stucking out', 'sharp edge', 'sliced', 'splinter',
    'jagged'
  ], weak: [ 'cut finger', 'cut hand', 'finger nail', 'nail sticking', 'pin sticking' ]},

  { cat: 'Slips, Trips & Falls Hazards', strong: [
    'trip hazard', 'tripping hazard', 'slip hazard', 'slipped', 'slippery',
    'wet floor', 'oil on floor', 'cross beam', 'cables across', 'cable across',
    'fall from height', 'nearly fell', 'rug', 'mat lifting', 'tape lifting'
  ], weak: [ 'uneven floor', 'unsteady' ]},

  { cat: 'Not Using or Misusing PPE', strong: [
    'no ppe', 'without ppe', 'ppe not', 'no safety glasses', 'no goggles',
    'no work boots', 'no gloves', 'no hi-vis', 'no hi vis', 'no mask',
    'no ear defender', 'no ear protect', 'helmet off', 'mask off',
    'no safety protection', 'no safety glass'
  ], weak: [ 'sanding without', 'without proper ventilation', 'safety glasses off' ]},

  { cat: 'Hazardous Substances / Chemical Hazard', strong: [
    'coshh', 'cossh', 'chemical', 'solvent', 'msds', 'hazardous substance',
    'fume', 'thinner', 'paint spill', 'adhesive spill'
  ], weak: [ 'aerosol', 'cleaning product' ]},

  { cat: 'Biohazards / Contamination', strong: [
    'biohazard', 'blood', 'bodily fluid', 'contamination', 'urine', 'faec',
    'sewage', 'mould', 'mold growth', 'rodent', 'pest', 'rats '
  ], weak: [ 'spit', 'vomit' ]},

  { cat: 'Electrical Hazards', strong: [
    'frayed lead', 'frayed cable', 'frayed extension', 'sparking', 'live cable',
    'exposed wire', 'wires exposed', 'pat fail', 'pat-fail', 'electric shock',
    'cabling in the wall', 'cabling in walls', 'plug damaged', 'socket damaged'
  ], weak: [ 'electrical' ]},

  { cat: 'Fire / Access / Egress Issues', strong: [
    'fire door', 'fire exit', 'fire alarm', 'fire risk', 'lpg', 'gas bottle',
    'smoking', 'cigarette', 'stubbed out', 'lit match',
    'extinguisher missing', 'extinguisher blocked', 'egress', 'access blocked',
    'door propt', 'door propped', 'block container', 'difficult to get to container',
    'parking by fire', 'pallets close to fire', 'blocked exit'
  ], weak: [ 'parking his car by', 'cannot reissue', 'covered in cushions', 'in gap where' ]},

  { cat: 'Inadequate or Wrong Equipment / Guards', strong: [
    'wrong equipment', 'inadequate equipment', 'no guard', 'guard missing',
    'unsuitable equipment', 'no edge protect', 'no harness'
  ], weak: [ 'should have used' ]},

  { cat: 'Using Defective or Wrong Tools/Equipment', strong: [
    'wrong tool', 'using damaged', 'using broken', 'using defective',
    'damaged tool', 'broken tool', 'modified tool', 'using a bent'
  ], weak: [ 'wrong size tool' ]},

  { cat: 'Defective or Damaged Equipment', strong: [
    'not working', 'leak', 'leakage', 'faulty', 'won\'t close', 'wont close',
    'flue ', 'temperature too low', 'not reaching temperature', 'compressed air',
    'blow gun', 'hearing hazard', 'loud noise when', 'broken seat', 'broken toilet',
    'toilet seat', 'not closing properly', 'door not closing', 'won\'t shut', 'wont shut'
  ], weak: [ 'broken', 'damaged', 'kettle', 'crack in', 'split in', 'dent in', 'air tube' ]},

  { cat: 'Unsafe Manual Handling / Posture', strong: [
    'too heavy', 'manual handl', 'lifting alone', 'twisted back', 'back twinge',
    'back pain', 'awkward lift', 'overreach', 'lifting from low', 'too heavy to recline',
    'too heavy to lift', 'reaching too high', 'reaching above'
  ], weak: [ 'hunched', 'awkward posture' ]},

  { cat: 'Unsafe Behaviour / Horseplay', strong: [
    'horseplay', 'play fight', 'mess about', 'messing about', 'mucking about',
    'practical joke', 'pushing each', 'running in', 'running on'
  ], weak: [ 'throwing' ]},

  { cat: 'Third-Party Unsafe Behaviour', strong: [
    'visitor', 'contractor', 'delivery driver', 'agency', 'third party',
    'third-party', 'subcontractor', 'haulier', 'courier'
  ], weak: [ 'maintenance company', 'engineer (visiting)' ]},

  { cat: 'Energy waste/environmental impact', strong: [
    'lights left on', 'light left on', 'lights on at end', 'lights on overnight',
    'left on at end of day', 'tap running', 'water running', 'energy waste',
    'environmental impact', 'manually switched off', 'not enough light',
    'not enough of light'
  ], weak: [ 'heater on overnight' ]},

  { cat: 'Security Issue', strong: [
    'door not locked', 'gate not locked', 'gate not being locked', 'unlocked',
    'front door not', 'left unlocked', 'security gate', 'tailgating',
    'gate open overnight', 'fence damaged', 'perimeter'
  ], weak: [ 'badge not', 'cctv' ]},

  { cat: 'Lack of Attention or Judgement', strong: [
    'pump truck left', 'trolley left', 'ladders left', 'ladder left',
    'left next to shutter', 'left by shutter', 'forgot to', 'distracted',
    'on phone while', 'not looking', 'splashes on', 'splash on'
  ], weak: [ 'left next to', 'left against', 'mirror' ]},

  { cat: 'Poor Housekeeping or Storage', strong: [
    'screw on', 'screw in area', 'screws lose', 'screws on floor',
    'bolts on floor', 'nails on floor', 'cluttered', 'overfilled', 'overfull',
    'stacked too high', 'stack of pallets', 'pallets across', 'rubbish on',
    'bin overfull', 'extraction bag', 'sawdust around', 'saw dust around',
    'in the walkway', 'in walk way', 'across walkway', 'across walk way',
    'walkway lines', 'stacked don', 'fallen from racking', 'fell from racking',
    'unsecured mech', 'mech in racking', 'rolls of', 'butt overflowing',
    'overflowing bin', 'mechs am being stacked', 'mechs being stacked',
    'way the mechs'
  ], weak: [
    'walkway', 'walk way', 'left hanging', 'base of chair', 'chair left',
    'rug', 'stacking', 'racking'
  ]}
];

// ── Behaviour signal — pushes parent toward "At-Risk Behavior" ─────────────
// If issue text mentions a person doing/not-doing something, it's behaviour.
const BEHAVIOUR_SIGNALS = [
  /\b(left|leaving|smoking|smoked|stubbed|propt|propped|parking|parked)\b/i,
  /\b(not using|misus|bypass|disabled|removed|tied open)\b/i,
  /\b(without (ppe|safety|gloves|boots|glasses|mask))\b/i,
  /\b(running|throwing|horseplay|messing|playing)\b/i,
  /\b(forgot|distracted|not looking|on phone)\b/i,
  /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/, // capitalised name (e.g. "Tom Malia")
  /\b(buttoning|sanding|lifting|carrying)\s+\w+\s+(without|alone)\b/i,
  /\bperson(s)? (was|were) /i,
  /\bvisitor|contractor|driver\b/i,
];

// ── Positive signal — wins outright ────────────────────────────────────────
const POSITIVE_SIGNALS = [
  /\b(well done|good job|great spot|good practice|nice (catch|spot)|excellent)\b/i,
  /\bthanks (to|for) /i,
  /\b(positive observation|noticed correctly|safe behaviour from)\b/i,
];

// ── Mapping: child category → most likely parent (when ambiguous) ──────────
// These are the "natural" parents from the historical data. If we have no
// behaviour signal and no positive signal, the parent comes from this map.
const CHILD_TO_PARENT = {
  'Positive Observation':                      'Positive Observation',
  'Bypassing or Removing Safety Devices':      'At-Risk Behavior',
  'Not Using or Misusing PPE':                 'At-Risk Behavior',
  'Unsafe Behaviour / Horseplay':              'At-Risk Behavior',
  'Unsafe Manual Handling / Posture':          'At-Risk Behavior',
  'Lack of Attention or Judgement':            'At-Risk Behavior',
  'Third-Party Unsafe Behaviour':              'At-Risk Behavior',
  'Using Defective or Wrong Tools/Equipment':  'At-Risk Behavior',
  // The rest default to At-Risk Condition
  'Sharp Edges / Protrusions':                 'At-Risk Condition',
  'Slips, Trips & Falls Hazards':              'At-Risk Condition',
  'Defective or Damaged Equipment':            'At-Risk Condition',
  'Inadequate or Wrong Equipment / Guards':    'At-Risk Condition',
  'Electrical Hazards':                        'At-Risk Condition',
  'Fire / Access / Egress Issues':             'At-Risk Condition',
  'Hazardous Substances / Chemical Hazard':    'At-Risk Condition',
  'Biohazards / Contamination':                'At-Risk Condition',
  'Poor Housekeeping or Storage':              'At-Risk Condition',
  'Energy waste/environmental impact':         'At-Risk Condition',
  'Security Issue':                            'At-Risk Condition',
};

// ── Main entrypoint ────────────────────────────────────────────────────────
function classifyNearMiss(text) {
  if (!text || typeof text !== 'string') {
    return { nearMissCategory: '', observationCategory: '', confidence: 0, matched: [] };
  }
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();

  // Positive observation short-circuit
  for (const re of POSITIVE_SIGNALS) {
    if (re.test(text)) {
      return {
        nearMissCategory:    'Positive Observation',
        observationCategory: 'Positive Observation',
        confidence: 0.9,
        matched: [re.source]
      };
    }
  }

  // Score every child-category bag (strong=2, weak=1)
  const scored = CHILD_RULES.map(rule => {
    const sHits = (rule.strong || []).filter(k => t.includes(k.toLowerCase()));
    const wHits = (rule.weak   || []).filter(k => t.includes(k.toLowerCase()));
    return { cat: rule.cat, hits: [...sHits, ...wHits], score: sHits.length * 2 + wHits.length, strong: sHits.length };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || b.strong - a.strong);

  if (scored.length === 0) {
    // No keyword hit — leave Observation Category blank so HS rep notices,
    // but populate parent with a safe default.
    return { nearMissCategory: 'At-Risk Condition', observationCategory: '', confidence: 0, matched: [] };
  }

  const top = scored[0];
  const childCat = top.cat;

  // Decide parent category
  let parent = CHILD_TO_PARENT[childCat] || 'At-Risk Condition';
  const hasBehaviourSignal = BEHAVIOUR_SIGNALS.some(re => re.test(text));
  if (hasBehaviourSignal && parent === 'At-Risk Condition') {
    parent = 'At-Risk Behavior';
  }

  // Confidence: based on strong-hit count and lead over runner-up
  let conf;
  if (top.strong >= 2)      conf = 0.92;
  else if (top.strong === 1 && top.score >= 3) conf = 0.85;
  else if (top.strong === 1) conf = 0.72;
  else if (top.score >= 2)  conf = 0.6;
  else                      conf = 0.5;

  if (scored.length > 1) {
    const lead = top.score - scored[1].score;
    if (lead === 0)      conf -= 0.15;
    else if (lead === 1) conf -= 0.05;
  }

  return {
    nearMissCategory:    parent,
    observationCategory: childCat,
    confidence: Math.max(0.4, Math.round(conf * 100) / 100),
    matched: top.hits
  };
}

// ── Module exports (works in Node, browser <script>, and Office Script) ───
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyNearMiss };
}
if (typeof window !== 'undefined') {
  window.classifyNearMiss = classifyNearMiss;
}
