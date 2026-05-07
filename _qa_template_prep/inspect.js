// One-shot inspection: pretty-print slide XML so I can read it with the Read tool.
const fs   = require('fs');
const path = require('path');
const JSZip= require('jszip');

const SRC = 'C:/Users/jonas.simonaitis/OneDrive - Repose Furniture/Desktop/Quality meetings/Repose QA Team Meeting 2026 wk 18.pptx';
const OUT = path.join(__dirname, 'pretty');

function pretty(xml){
  // Inject newlines after every closing tag and after every opening-without-children tag.
  return xml.replace(/></g, '>\n<');
}

(async()=>{
  fs.mkdirSync(OUT, { recursive: true });
  const buf = fs.readFileSync(SRC);
  const zip = await JSZip.loadAsync(buf);
  const slideNames = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const name of slideNames){
    const xml = await zip.file(name).async('string');
    const out = path.join(OUT, name.replace(/\//g,'__'));
    fs.writeFileSync(out, pretty(xml), 'utf8');
    console.log(`wrote ${out}  (${xml.length} chars)`);
  }
})();
