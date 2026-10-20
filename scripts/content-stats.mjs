#!/usr/bin/env node
// Quick per-lesson counts: steps / examples / exercises / other graded steps, plus test pool and project size.
//   node scripts/content-stats.mjs content/modules/*.yaml
import fs from 'node:fs';
import YAML from 'yaml';

for (const f of process.argv.slice(2)) {
  const d = YAML.parse(fs.readFileSync(f, 'utf8'));
  if (d.challenges) {
    console.log(`${f}: ${d.challenges.length} challenges`);
    continue;
  }
  const lessons = (d.lessons ?? []).map((l) => {
    const n = (t) => l.steps.filter((s) => s.type === t).length;
    return `${l.id}: ${l.steps.length} steps, ${n('example')} examples, ${n('exercise')} exercises, ${n('quiz') + n('predict') + n('fill') + n('parsons')} other graded`;
  });
  console.log(`${f}\n  ${lessons.join('\n  ')}\n  testPool ${d.testPool?.length ?? 0}, project tasks ${d.project?.tasks?.length ?? 0}`);
}
