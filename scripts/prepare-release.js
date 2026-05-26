#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractLatestRelease } = require('../src/lib/changelog-utils');

function findChangelogPath() {
  const candidates = ['CHANGELOG', 'CHANGELOG.md'];

  for (const candidate of candidates) {
    const candidatePath = path.join(process.cwd(), candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error('未找到 CHANGELOG 或 CHANGELOG.md');
}

function appendGithubOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function main() {
  const changelogPath = findChangelogPath();
  const content = fs.readFileSync(changelogPath, 'utf8');
  const release = extractLatestRelease(content);

  if (release.errors.length > 0) {
    release.errors.forEach((error) => {
      console.error(`- ${error}`);
    });
    process.exit(1);
  }

  if (!release.latestVersion || !release.entry) {
    console.error('未找到可发布的版本');
    process.exit(1);
  }

  const tag = `v${release.latestVersion}`;
  const title = tag;
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icetv-release-'));
  const notesPath = path.join(outputDir, `${tag}.md`);

  fs.writeFileSync(notesPath, release.notes, 'utf8');

  appendGithubOutput('version', release.latestVersion);
  appendGithubOutput('tag', tag);
  appendGithubOutput('title', title);
  appendGithubOutput('notes_file', notesPath);

  console.log(`version=${release.latestVersion}`);
  console.log(`tag=${tag}`);
  console.log(`title=${title}`);
  console.log(`notes_file=${notesPath}`);
}

main();
