const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 1250 }, deviceScaleFactor: 1 });
  for (const f of fs.readdirSync('svg')) {
    await p.goto('file://' + path.resolve('svg', f));
    await p.screenshot({ path: 'png/' + f.replace('.svg', '.png') });
  }
  await b.close();
})();
