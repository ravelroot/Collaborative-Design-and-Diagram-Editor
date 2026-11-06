import path from 'node:path';
import { fileURLToPath } from 'node:url';

const data = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = (s) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

const where = (file, line) => {
  if (!file) return '';
  const abs = file.startsWith('file:') ? fileURLToPath(file) : file;
  const rel = path.relative(process.cwd(), abs).split(path.sep).join('/');
  return `file=${prop(rel)}${line ? `,line=${line}` : ''},`;
};

export default async function* githubAnnotations(source) {
  const enabled = process.env.GITHUB_ACTIONS === 'true';
  for await (const event of source) {
    if (!enabled || event.type !== 'test:fail') continue;
    const { name, details, file, line } = event.data;
    const error = details?.error;
    if (!error || error.failureType === 'subtestsFailed') continue;
    const cause = error.cause ?? error;
    const stack = String(cause?.stack ?? '').split('\n').slice(1, 7).join('\n');
    const text = `${cause?.message ?? cause}${stack ? '\n' + stack : ''}`.slice(0, 4000);
    yield `::error ${where(file, line)}title=${prop(name)}::${data(text)}\n`;
  }
}
