const fs = require('fs');
const path = require('path');

const targetDirs = [
  'apps/web/src/pages/officer',
  'apps/web/src/pages/director',
  'apps/web/src/components/dashboard',
  'apps/web/src/components/layout',
  'apps/web/src/components/settings',
];

const issues = [];

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Check for dark text colors without dark:text-* on the same line or in className
    const darkTextMatches = line.match(/\btext-(green-(?:700|800|900|950)|gray-(?:700|800|900|950)|night-(?:700|800|900|950))\b/g);
    if (darkTextMatches) {
      // Check if there is NO dark:text on this line
      const hasDarkText = /dark:text-/.test(line);
      // Also ignore if background is explicitly light in dark mode like dark:bg-white or dark:bg-amber-400
      const hasLightBgInDark = /dark:bg-(white|amber|green-100|green-200|green-50|night-50|night-100)/.test(line);
      if (!hasDarkText && !hasLightBgInDark) {
        issues.push({
          file: path.relative('apps/web/src', filePath).replace(/\\/g, '/'),
          line: idx + 1,
          matches: darkTextMatches,
          snippet: line.trim().slice(0, 100)
        });
      }
    }
  });
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) scanDir(full);
    else if (item.name.endsWith('.tsx')) checkFile(full);
  }
}

targetDirs.forEach(scanDir);

console.log(`FOUND ${issues.length} POTENTIAL CONTRAST ISSUES:`);
issues.forEach(iss => {
  console.log(`${iss.file}:${iss.line} [${iss.matches.join(', ')}] -> ${iss.snippet}`);
});
