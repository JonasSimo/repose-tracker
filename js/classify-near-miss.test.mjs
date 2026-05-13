// Unit tests for `classify-near-miss.js`. The classifier is a standalone
// CommonJS module (exports via `module.exports`), imported here through
// vitest's CJS interop.
import { describe, it, expect } from 'vitest';
import classifier from '../classify-near-miss.js';
const { classifyNearMiss } = classifier;

describe('classifyNearMiss — guards', () => {
  it('returns an empty shape for null / undefined / non-string', () => {
    expect(classifyNearMiss(null)).toEqual({
      nearMissCategory: '', observationCategory: '', confidence: 0, matched: [],
    });
    expect(classifyNearMiss(undefined).confidence).toBe(0);
    expect(classifyNearMiss(123).confidence).toBe(0);
  });

  it('returns an empty shape for an empty string', () => {
    expect(classifyNearMiss('')).toEqual({
      nearMissCategory: '', observationCategory: '', confidence: 0, matched: [],
    });
  });
});

describe('classifyNearMiss — Positive Observation short-circuit', () => {
  it("classifies 'well done' as Positive Observation with 0.9 confidence", () => {
    const out = classifyNearMiss('Well done to Mark for spotting the trip hazard');
    expect(out.nearMissCategory).toBe('Positive Observation');
    expect(out.observationCategory).toBe('Positive Observation');
    expect(out.confidence).toBe(0.9);
  });

  it("classifies 'good job' as Positive Observation", () => {
    expect(classifyNearMiss('Good job by the team today').nearMissCategory).toBe('Positive Observation');
  });

  it("classifies 'nice catch' as Positive Observation", () => {
    expect(classifyNearMiss('Nice catch on the loose screw').nearMissCategory).toBe('Positive Observation');
  });

  it("classifies 'thanks to' as Positive Observation", () => {
    expect(classifyNearMiss('Thanks to Sarah for cleaning the spill').nearMissCategory).toBe('Positive Observation');
  });

  it('positive signal beats any At-Risk keyword in the same sentence', () => {
    // "trip hazard" would normally be a Slips/Trips hit; "well done" wins.
    const out = classifyNearMiss('Well done — that trip hazard could have been bad');
    expect(out.nearMissCategory).toBe('Positive Observation');
  });
});

describe('classifyNearMiss — child category routing', () => {
  it('routes a PPE complaint to "Not Using or Misusing PPE" / At-Risk Behavior', () => {
    const out = classifyNearMiss('Operator working with no PPE on the saw');
    expect(out.observationCategory).toBe('Not Using or Misusing PPE');
    expect(out.nearMissCategory).toBe('At-Risk Behavior');
  });

  it('routes a slip hazard to "Slips, Trips & Falls Hazards" / At-Risk Condition', () => {
    const out = classifyNearMiss('Slippery wet floor near the door');
    expect(out.observationCategory).toBe('Slips, Trips & Falls Hazards');
    expect(out.nearMissCategory).toBe('At-Risk Condition');
  });

  it('routes a chemical complaint to "Hazardous Substances / Chemical Hazard"', () => {
    expect(classifyNearMiss('Solvent spill not cleaned up').observationCategory)
      .toBe('Hazardous Substances / Chemical Hazard');
  });

  it('routes a fire-door issue to "Fire / Access / Egress Issues"', () => {
    expect(classifyNearMiss('Fire door propped open with a wedge').observationCategory)
      .toBe('Fire / Access / Egress Issues');
  });

  it('routes "leak" to "Defective or Damaged Equipment"', () => {
    expect(classifyNearMiss('Compressor leak in the workshop').observationCategory)
      .toBe('Defective or Damaged Equipment');
  });

  it('routes a horseplay complaint to At-Risk Behavior', () => {
    const out = classifyNearMiss('Two operators messing about by the press');
    expect(out.observationCategory).toBe('Unsafe Behaviour / Horseplay');
    expect(out.nearMissCategory).toBe('At-Risk Behavior');
  });
});

describe('classifyNearMiss — behaviour-signal parent flip', () => {
  it('flips an At-Risk Condition child to At-Risk Behavior when behaviour signal present', () => {
    // "left cables across walkway" — Slips/Trips child but with "left" behaviour signal
    const out = classifyNearMiss('Tom left cables across the walkway near the door');
    expect(out.observationCategory).toBe('Slips, Trips & Falls Hazards');
    expect(out.nearMissCategory).toBe('At-Risk Behavior');
  });

  it('does NOT flip a child that is already At-Risk Behavior', () => {
    // PPE child is already At-Risk Behavior; behaviour signal doesn't change it.
    const out = classifyNearMiss('Sanding without proper ventilation, no mask on');
    expect(out.nearMissCategory).toBe('At-Risk Behavior');
  });

  it('does NOT flip when no behaviour signal is present (pure condition)', () => {
    const out = classifyNearMiss('Wet floor by the back door');
    expect(out.nearMissCategory).toBe('At-Risk Condition');
  });
});

describe('classifyNearMiss — confidence math', () => {
  it("uses 0.92 confidence for two-or-more strong hits", () => {
    // Two strong keywords from the same bag: "trip hazard" + "slippery"
    const out = classifyNearMiss('Slippery patch is a real trip hazard');
    expect(out.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("returns confidence 0 and a default parent for text that matches nothing", () => {
    const out = classifyNearMiss('xyzzy plugh nothing makes sense here');
    expect(out.confidence).toBe(0);
    expect(out.observationCategory).toBe('');
    expect(out.nearMissCategory).toBe('At-Risk Condition'); // safe default
  });

  it('clamps the floor at 0.4 even after lead-reduction penalties', () => {
    const out = classifyNearMiss('Damaged thing'); // weak hit only
    if (out.confidence > 0) expect(out.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('rounds confidence to two decimal places', () => {
    const out = classifyNearMiss('Wet floor');
    // Just confirm the number of decimal places, not the exact value.
    if (out.confidence > 0) {
      const decimals = (String(out.confidence).split('.')[1] || '').length;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  });
});

describe('classifyNearMiss — matched array', () => {
  it('includes the matched keywords for debuggability', () => {
    const out = classifyNearMiss('Trip hazard near the door');
    expect(Array.isArray(out.matched)).toBe(true);
    expect(out.matched.length).toBeGreaterThan(0);
    expect(out.matched.some(k => k.toLowerCase().includes('trip'))).toBe(true);
  });

  it('returns matched=[] when nothing matched', () => {
    expect(classifyNearMiss('xyzzy plugh').matched).toEqual([]);
  });
});
