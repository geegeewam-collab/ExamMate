import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const appDir = join(root, 'ios', 'App', 'App');
const projectFile = join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const storyboard = join(appDir, 'Base.lproj', 'Main.storyboard');
const plist = join(appDir, 'Info.plist');
for (const file of [projectFile, storyboard, plist]) {
  if (!existsSync(file)) throw new Error(`Missing ${file}. Run "npm run cap:sync:ios" after installing dependencies.`);
}

mkdirSync(appDir, { recursive: true });
const files = [
  { id: 'A21E4A7D10B84F1A9C3D1101', build: 'A21E4A7D10B84F1A9C3D1102', name: 'ExamMateMediaPlugin.swift' },
  { id: 'A21E4A7D10B84F1A9C3D1103', build: 'A21E4A7D10B84F1A9C3D1104', name: 'ViewController.swift' },
];
for (const file of files) copyFileSync(join(root, 'ios', 'templates', file.name), join(appDir, file.name));

function replaceRange(source, range, value) { return source.slice(0, range.start) + value + source.slice(range.end); }
function findGroup(text) {
  const candidates = [...text.matchAll(/([A-F0-9]{24}) \/\* App \*\/ = \{/g)];
  for (const candidate of candidates.reverse()) {
    const id = candidate[1];
    const open = text.indexOf('{', candidate.index);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) {
        const value = text.slice(candidate.index, i + 1);
        if (/isa\s*=\s*PBXGroup;/.test(value) && /path\s*=\s*App;/.test(value)) return { id, start: candidate.index, end: i + 1, text: value };
        break;
      }
    }
  }
  throw new Error('Could not locate the generated iOS App PBXGroup. Inspect ios/App/App.xcodeproj/project.pbxproj.');
}
function insertIntoArray(objectText, property, entries) {
  const re = new RegExp(`(${property}\\s*=\\s*\\()`, 'm');
  if (!re.test(objectText)) throw new Error(`Could not locate ${property} array in Xcode project object.`);
  let updated = objectText;
  for (const entry of entries) if (!updated.includes(entry.trim())) updated = updated.replace(re, `$1\n\t\t\t\t${entry}`);
  return updated;
}

let pbx = readFileSync(projectFile, 'utf8');
const packageMeta = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appVersion = String(packageMeta.version || '2.1.5');
const appBuild = '7';
// Keep the generated iOS app's marketing/build versions in sync with the source release.
pbx = pbx.replace(/MARKETING_VERSION\s*=\s*[^;]+;/g, `MARKETING_VERSION = ${appVersion};`);
pbx = pbx.replace(/CURRENT_PROJECT_VERSION\s*=\s*[^;]+;/g, `CURRENT_PROJECT_VERSION = ${appBuild};`);
// Add PBXFileReference and PBXBuildFile declarations independently so a partially
// completed previous run can be repaired safely on the next sync.
for (const file of files) {
  const refMarker = `${file.id} /* ${file.name} */`;
  const buildMarker = `${file.build} /* ${file.name} in Sources */`;
  if (!pbx.includes(refMarker)) {
    const ref = `\n\t\t${file.id} /* ${file.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${file.name}; sourceTree = "<group>"; };`;
    if (!pbx.includes('/* End PBXFileReference section */')) throw new Error('Unexpected Xcode project PBXFileReference section.');
    pbx = pbx.replace('/* End PBXFileReference section */', `${ref}\n\t/* End PBXFileReference section */`);
  }
  if (!pbx.includes(buildMarker)) {
    const build = `\n\t\t${file.build} /* ${file.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${file.id} /* ${file.name} */; };`;
    if (!pbx.includes('/* End PBXBuildFile section */')) throw new Error('Unexpected Xcode project PBXBuildFile section.');
    pbx = pbx.replace('/* End PBXBuildFile section */', `${build}\n\t/* End PBXBuildFile section */`);
  }
}

let group = findGroup(pbx);
let groupText = group.text;
groupText = insertIntoArray(groupText, 'children', files.map(f => `${f.id} /* ${f.name} */,`));
pbx = replaceRange(pbx, group, groupText);

// Add both native sources to the app target's Sources phase.
const sourceMatches = [...pbx.matchAll(/([A-F0-9]{24}) \/\* Sources \*\/ = \{/g)];
if (!sourceMatches.length) throw new Error('Could not locate the iOS Sources build phase.');
let sourcePhase = null;
for (const match of sourceMatches) {
  const open = pbx.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < pbx.length; i++) {
    if (pbx[i] === '{') depth++;
    else if (pbx[i] === '}' && --depth === 0) {
      const candidate = { start: match.index, end: i + 1, text: pbx.slice(match.index, i + 1) };
      if (/isa\s*=\s*PBXSourcesBuildPhase;/.test(candidate.text)) { sourcePhase = candidate; break; }
      break;
    }
  }
  if (sourcePhase) break;
}
if (!sourcePhase) throw new Error('Could not locate a PBXSourcesBuildPhase object.');
const sourceText = insertIntoArray(sourcePhase.text, 'files', files.map(f => `${f.build} /* ${f.name} in Sources */,`));
pbx = replaceRange(pbx, sourcePhase, sourceText);
writeFileSync(projectFile, pbx);

// Speech recognition requires both privacy strings. Background audio is used only for the reader's spoken output.
let info = readFileSync(plist, 'utf8');
const entries = [
  ['NSMicrophoneUsageDescription', 'Exam Mate uses the microphone so you can ask questions while studying.'],
  ['NSSpeechRecognitionUsageDescription', 'Exam Mate uses speech recognition to understand your spoken study questions.'],
];
const appendToRootDictionary = (xml, value) => {
  const rootEnd = xml.lastIndexOf('</dict>');
  if (rootEnd < 0) throw new Error('Info.plist has no root dictionary closing tag.');
  return xml.slice(0, rootEnd) + value + '\n' + xml.slice(rootEnd);
};
for (const [key, value] of entries) {
  if (!info.includes(`<key>${key}</key>`)) info = appendToRootDictionary(info, `    <key>${key}</key>\n    <string>${value}</string>`);
}
const backgroundKey = info.indexOf('<key>UIBackgroundModes</key>');
if (backgroundKey < 0) {
  info = appendToRootDictionary(info, '    <key>UIBackgroundModes</key>\n    <array><string>audio</string></array>');
} else {
  const arrayStart = info.indexOf('<array>', backgroundKey);
  const arrayEnd = info.indexOf('</array>', arrayStart);
  if (arrayStart < 0 || arrayEnd < 0) throw new Error('UIBackgroundModes exists but is not an array in Info.plist.');
  const modes = info.slice(arrayStart, arrayEnd);
  if (!/<string>\s*audio\s*<\/string>/.test(modes)) info = info.slice(0, arrayEnd) + '<string>audio</string>' + info.slice(arrayEnd);
}
writeFileSync(plist, info);

// Capacitor's generated storyboard hosts the bridge view controller. Use our subclass to register the native media plugin.
let scene = readFileSync(storyboard, 'utf8');
scene = scene.replace(/customClass="CAPBridgeViewController"\s+customModule="Capacitor"/, 'customClass="MainViewController" customModule="App"');
if (!scene.includes('customClass="MainViewController"')) throw new Error('Could not set MainViewController in Main.storyboard. Check the generated storyboard format.');
writeFileSync(storyboard, scene);
console.log(`iOS native audio bridge configured for v${appVersion} (build ${appBuild}). Run npm run cap:open:ios on macOS.`);
