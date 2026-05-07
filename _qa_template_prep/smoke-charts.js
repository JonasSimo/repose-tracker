// Verifies the trend-chart XML rewrite logic on chart1 (S5 Complaints).
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function xmlEscape(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

function buildPtList(values, formatStr){
  const fmt = formatStr ? `<c:formatCode>${formatStr}</c:formatCode>` : '';
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(String(v))}</c:v></c:pt>`).join('');
  return `${fmt}<c:ptCount val="${values.length}"/>${pts}`;
}
function rewriteCategoryLabels(xml, labels){
  return xml.replace(
    /(<c:cat>\s*<c:strRef>[\s\S]*?<c:strCache>)[\s\S]*?(<\/c:strCache>)/g,
    (_, open, close) => open + buildPtList(labels) + close
  );
}
function rewriteFirstSeriesValues(xml, values){
  let done = false;
  return xml.replace(
    /(<c:val>\s*<c:numRef>[\s\S]*?<c:numCache>)[\s\S]*?(<\/c:numCache>)/g,
    (m, open, close) => { if (done) return m; done = true;
      return open + buildPtList(values, 'General') + close; }
  );
}
function updateTrendChart(xml, labels, values){
  return rewriteFirstSeriesValues(rewriteCategoryLabels(xml, labels), values);
}

(async()=>{
  const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(__dirname,'../qa-meeting-template.pptx')));
  let xml = await zip.file('ppt/charts/chart1.xml').async('string');

  const labels = ['Week 11','Week 12','Week 13','Week 14','Week 15','Week 16','Week 17','Week 18'];
  const values = [4, 1, 0, 5, 2, 3, 1, 3];
  xml = updateTrendChart(xml, labels, values);

  // Sanity check: extract resulting strCache and numCache contents
  const strCache = (xml.match(/<c:cat>[\s\S]*?<c:strCache>([\s\S]*?)<\/c:strCache>/g) || []);
  const numCache = (xml.match(/<c:val>[\s\S]*?<c:numCache>([\s\S]*?)<\/c:numCache>/g) || []);
  console.log('strCache count under c:cat:', strCache.length);
  console.log('numCache count under c:val:', numCache.length);
  for (let i = 0; i < strCache.length; i++){
    const cap = strCache[i].match(/<c:v>[^<]+<\/c:v>/g) || [];
    console.log(`  strCache[${i}] values:`, cap.map(c => c.replace(/<\/?c:v>/g,'')).join(', '));
  }
  for (let i = 0; i < numCache.length; i++){
    const cap = numCache[i].match(/<c:v>[^<]+<\/c:v>/g) || [];
    console.log(`  numCache[${i}] values:`, cap.map(c => c.replace(/<\/?c:v>/g,'')).join(', '));
  }

  zip.file('ppt/charts/chart1.xml', xml);
  const buf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{level:6} });
  const outPath = path.resolve(__dirname, 'smoke-chart-output.pptx');
  fs.writeFileSync(outPath, buf);
  console.log('\nWrote', outPath);
})();
