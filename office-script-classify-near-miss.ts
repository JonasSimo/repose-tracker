/**
 * Office Script — classifyNearMiss
 * ─────────────────────────────────────────────────────────────────────────
 * Paste this whole file into Excel:
 *   Near Miss Log.xlsx → Automate → New Script → replace template → Save as
 *   "classifyNearMiss".
 *
 * Power Automate use:
 *   Add an "Excel Online (Business) → Run script" action AFTER
 *   "Get response details" and BEFORE "Create item" in the existing flow.
 *   Pass the issue text from the Form response into the `issueText` parameter.
 *   The script returns { nearMissCategory, observationCategory, confidence }
 *   which you map into Create_item and Add_a_row_into_a_table.
 *
 * No workbook changes required — script does NOT read or write any cells.
 * It's a stateless classifier that lives in the workbook only because Office
 * Scripts must live somewhere.
 *
 * Source of truth for the rules: classify-near-miss.js. Keep them in sync.
 */

interface ClassifyResult {
  nearMissCategory: 'At-Risk Condition' | 'At-Risk Behavior' | 'Positive Observation' | '';
  observationCategory: string;
  confidence: number;
}

function main(workbook: ExcelScript.Workbook, issueText: string): ClassifyResult {
  if (!issueText || typeof issueText !== 'string') {
    return { nearMissCategory: 'At-Risk Condition', observationCategory: '', confidence: 0 };
  }
  const t = issueText.toLowerCase().replace(/\s+/g, ' ').trim();

  // ── Positive observation short-circuit ────────────────────────────────
  const positivePatterns = [
    /\b(well done|good job|great spot|good practice|nice (catch|spot)|excellent)\b/i,
    /\bthanks (to|for) /i,
    /\b(positive observation|noticed correctly|safe behaviour from)\b/i,
  ];
  for (const re of positivePatterns) {
    if (re.test(issueText)) {
      return {
        nearMissCategory: 'Positive Observation',
        observationCategory: 'Positive Observation',
        confidence: 0.9,
      };
    }
  }

  // ── Child-category keyword bags (strong=2, weak=1) ────────────────────
  type Rule = { cat: string; strong: string[]; weak: string[] };
  const rules: Rule[] = [
    { cat: 'Bypassing or Removing Safety Devices',
      strong: ['bypass','guard removed','guard disabled','cable-tie','cable tie','tied open','interlock','safety device disabled','override switch'],
      weak:   ['jammed open','wedged'] },
    { cat: 'Sharp Edges / Protrusions',
      strong: ['staple','mill staple','protrud','sticking out','sticking up','sticking through','stucking out','sharp edge','sliced','splinter','jagged'],
      weak:   ['cut finger','cut hand','finger nail','nail sticking','pin sticking'] },
    { cat: 'Slips, Trips & Falls Hazards',
      strong: ['trip hazard','tripping hazard','slip hazard','slipped','slippery','wet floor','oil on floor','cross beam','cables across','cable across','fall from height','nearly fell','rug','mat lifting','tape lifting'],
      weak:   ['uneven floor','unsteady'] },
    { cat: 'Not Using or Misusing PPE',
      strong: ['no ppe','without ppe','ppe not','no safety glasses','no goggles','no work boots','no gloves','no hi-vis','no hi vis','no mask','no ear defender','no ear protect','helmet off','mask off','no safety protection','no safety glass'],
      weak:   ['sanding without','without proper ventilation','safety glasses off'] },
    { cat: 'Hazardous Substances / Chemical Hazard',
      strong: ['coshh','cossh','chemical','solvent','msds','hazardous substance','fume','thinner','paint spill','adhesive spill'],
      weak:   ['aerosol','cleaning product'] },
    { cat: 'Biohazards / Contamination',
      strong: ['biohazard','blood','bodily fluid','contamination','urine','faec','sewage','mould','mold growth','rodent','pest','rats '],
      weak:   ['spit','vomit'] },
    { cat: 'Electrical Hazards',
      strong: ['frayed lead','frayed cable','frayed extension','sparking','live cable','exposed wire','wires exposed','pat fail','pat-fail','electric shock','cabling in the wall','cabling in walls','plug damaged','socket damaged'],
      weak:   ['electrical'] },
    { cat: 'Fire / Access / Egress Issues',
      strong: ['fire door','fire exit','fire alarm','fire risk','lpg','gas bottle','smoking','cigarette','stubbed out','lit match','extinguisher missing','extinguisher blocked','egress','access blocked','door propt','door propped','block container','difficult to get to container','parking by fire','pallets close to fire','blocked exit'],
      weak:   ['parking his car by','cannot reissue','covered in cushions','in gap where'] },
    { cat: 'Inadequate or Wrong Equipment / Guards',
      strong: ['wrong equipment','inadequate equipment','no guard','guard missing','unsuitable equipment','no edge protect','no harness'],
      weak:   ['should have used'] },
    { cat: 'Using Defective or Wrong Tools/Equipment',
      strong: ['wrong tool','using damaged','using broken','using defective','damaged tool','broken tool','modified tool','using a bent'],
      weak:   ['wrong size tool'] },
    { cat: 'Defective or Damaged Equipment',
      strong: ['not working','leak','leakage','faulty',"won't close",'wont close','flue ','temperature too low','not reaching temperature','compressed air','blow gun','hearing hazard','loud noise when','broken seat','broken toilet','toilet seat','not closing properly','door not closing',"won't shut",'wont shut'],
      weak:   ['broken','damaged','kettle','crack in','split in','dent in','air tube'] },
    { cat: 'Unsafe Manual Handling / Posture',
      strong: ['too heavy','manual handl','lifting alone','twisted back','back twinge','back pain','awkward lift','overreach','lifting from low','too heavy to recline','too heavy to lift','reaching too high','reaching above'],
      weak:   ['hunched','awkward posture'] },
    { cat: 'Unsafe Behaviour / Horseplay',
      strong: ['horseplay','play fight','mess about','messing about','mucking about','practical joke','pushing each','running in','running on'],
      weak:   ['throwing'] },
    { cat: 'Third-Party Unsafe Behaviour',
      strong: ['visitor','contractor','delivery driver','agency','third party','third-party','subcontractor','haulier','courier'],
      weak:   ['maintenance company','engineer (visiting)'] },
    { cat: 'Energy waste/environmental impact',
      strong: ['lights left on','light left on','lights on at end','lights on overnight','left on at end of day','tap running','water running','energy waste','environmental impact','manually switched off','not enough light','not enough of light'],
      weak:   ['heater on overnight'] },
    { cat: 'Security Issue',
      strong: ['door not locked','gate not locked','gate not being locked','unlocked','front door not','left unlocked','security gate','tailgating','gate open overnight','fence damaged','perimeter'],
      weak:   ['badge not','cctv'] },
    { cat: 'Lack of Attention or Judgement',
      strong: ['pump truck left','trolley left','ladders left','ladder left','left next to shutter','left by shutter','forgot to','distracted','on phone while','not looking','splashes on','splash on'],
      weak:   ['left next to','left against','mirror'] },
    { cat: 'Poor Housekeeping or Storage',
      strong: ['screw on','screw in area','screws lose','screws on floor','bolts on floor','nails on floor','cluttered','overfilled','overfull','stacked too high','stack of pallets','pallets across','rubbish on','bin overfull','extraction bag','sawdust around','saw dust around','in the walkway','in walk way','across walkway','across walk way','walkway lines','stacked don','fallen from racking','fell from racking','unsecured mech','mech in racking','rolls of','butt overflowing','overflowing bin','mechs am being stacked','mechs being stacked','way the mechs'],
      weak:   ['walkway','walk way','left hanging','base of chair','chair left','rug','stacking','racking'] },
  ];

  // Score each rule
  type Score = { cat: string; score: number; strong: number };
  const scored: Score[] = [];
  for (const r of rules) {
    let strongHits = 0, weakHits = 0;
    for (const k of r.strong) if (t.indexOf(k.toLowerCase()) >= 0) strongHits++;
    for (const k of r.weak)   if (t.indexOf(k.toLowerCase()) >= 0) weakHits++;
    const total = strongHits * 2 + weakHits;
    if (total > 0) scored.push({ cat: r.cat, score: total, strong: strongHits });
  }
  scored.sort((a, b) => b.score - a.score || b.strong - a.strong);

  if (scored.length === 0) {
    return { nearMissCategory: 'At-Risk Condition', observationCategory: '', confidence: 0 };
  }

  const top = scored[0];

  // Map child → parent (default), then check for behaviour signals to flip
  const childToParent: Record<string, 'At-Risk Condition' | 'At-Risk Behavior' | 'Positive Observation'> = {
    'Bypassing or Removing Safety Devices':      'At-Risk Behavior',
    'Not Using or Misusing PPE':                 'At-Risk Behavior',
    'Unsafe Behaviour / Horseplay':              'At-Risk Behavior',
    'Unsafe Manual Handling / Posture':          'At-Risk Behavior',
    'Lack of Attention or Judgement':            'At-Risk Behavior',
    'Third-Party Unsafe Behaviour':              'At-Risk Behavior',
    'Using Defective or Wrong Tools/Equipment':  'At-Risk Behavior',
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
  let parent = childToParent[top.cat] || 'At-Risk Condition';

  const behaviourSignals = [
    /\b(left|leaving|smoking|smoked|stubbed|propt|propped|parking|parked)\b/i,
    /\b(not using|misus|bypass|disabled|removed|tied open)\b/i,
    /\bwithout (ppe|safety|gloves|boots|glasses|mask)\b/i,
    /\b(running|throwing|horseplay|messing|playing)\b/i,
    /\b(forgot|distracted|not looking|on phone)\b/i,
    /\bvisitor|contractor|driver\b/i,
  ];
  const hasBehaviour = behaviourSignals.some(re => re.test(issueText));
  if (hasBehaviour && parent === 'At-Risk Condition') parent = 'At-Risk Behavior';

  // Confidence
  let conf: number;
  if (top.strong >= 2)                                conf = 0.92;
  else if (top.strong === 1 && top.score >= 3)        conf = 0.85;
  else if (top.strong === 1)                          conf = 0.72;
  else if (top.score >= 2)                            conf = 0.6;
  else                                                conf = 0.5;
  if (scored.length > 1) {
    const lead = top.score - scored[1].score;
    if (lead === 0)      conf -= 0.15;
    else if (lead === 1) conf -= 0.05;
  }
  conf = Math.max(0.4, Math.round(conf * 100) / 100);

  return {
    nearMissCategory: parent,
    observationCategory: top.cat,
    confidence: conf,
  };
}
