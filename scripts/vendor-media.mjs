import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = 'node_modules/mux.js';
const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
if (pkg.version !== '6.3.0') throw Error('Review the media vendor patch before changing mux.js.');
const hashes = {
  'adts.js': '6b7863762671e5813ac29875fa94d2972704c922a9fe901fe9d46cb397af3c7e',
  'transmuxer.js': 'cc55f0b910a9aa157c436971838f848b0a14cec26f77d3e2a5fa9d5cdfaf34c0',
};
const output = await build({
  stdin: {
    contents:
      "import mux from 'mux.js/cjs/mp4/transmuxer.js'; import AdtsStream from 'mux.js/cjs/codecs/adts.js'; export const Transmuxer = mux.Transmuxer; export { AdtsStream };",
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  write: false,
  legalComments: 'inline',
  banner: {
    js: '// Generated from mux.js 6.3.0 (Apache-2.0). See scripts/vendor-media.mjs and mux-LICENSE.txt.\n// Flux changes: reject malformed AAC sizes/rates, bound audio frame and video NAL counts.',
  },
  plugins: [
    {
      name: 'reviewed-media-guards',
      setup(build) {
        build.onLoad(
          { filter: /mux\.js[\\/]cjs[\\/](?:codecs[\\/]adts|mp4[\\/]transmuxer)\.js$/ },
          async ({ path }) => {
            let source = await readFile(path, 'utf8');
            const name = path.endsWith('adts.js') ? 'adts.js' : 'transmuxer.js';
            if (createHash('sha256').update(source).digest('hex') !== hashes[name])
              throw Error('Vendor source changed: ' + name);
            if (name === 'adts.js') {
              source = source.replace('frameNum = 0;', 'frameNum = 0, fluxFrames = 0;');
              source = source.replace(
                '      sampleCount =',
                '      if (frameLength <= 7 + protectionSkipBytes) throw new Error("Invalid AAC frame length.");\n      sampleCount =',
              );
              source = source.replace(
                "      this.trigger('data', {\n        pts:",
                '      if (!Number.isFinite(adtsFrameDuration) || adtsFrameDuration <= 0 || ++fluxFrames > 32768) throw new Error("Invalid or excessive AAC frames.");\n      this.trigger(\'data\', {\n        pts:',
              );
            } else {
              source = source.replace(
                '    nalUnits.push(nalUnit);',
                '    if (nalUnits.length >= 65536 || nalUnit.data.byteLength > 8388608) throw new Error("Excessive H.264 metadata or sample size.");\n    nalUnits.push(nalUnit);',
              );
              source = source.replace(
                '    while (nalUnits.length) {',
                '    var fluxVcl = nalUnits.findIndex(function(nal) { return (nal.data[0] & 31) >= 1 && (nal.data[0] & 31) <= 5; });\n    var fluxAud = nalUnits.findIndex(function(nal) { return nal.nalUnitType === "access_unit_delimiter_rbsp"; });\n    if (fluxVcl >= 0 && (fluxAud < 0 || fluxAud > fluxVcl)) throw new Error("H.264 access unit boundaries are missing. This segment needs another remux workflow.");\n    while (nalUnits.length) {',
              );
              source = source.replace(
                '    if (!gops[0][0].keyFrame) {',
                '    if (!gops[0][0].keyFrame) {\n      throw new Error("This TS segment starts between keyframes. A continuous remux workflow is needed; no frames were discarded.");',
              );
            }
            return { contents: source, loader: 'js' };
          },
        );
      },
    },
  ],
});
await mkdir('src/engine/media/vendor', { recursive: true });
await writeFile('src/engine/media/vendor/mux-transmuxer.js', output.outputFiles[0].contents);
await writeFile('src/engine/media/vendor/mux-LICENSE.txt', await readFile(`${root}/LICENSE`));
console.log(`Generated reviewed media module: ${output.outputFiles[0].contents.length} bytes.`);
