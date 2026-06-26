#!/usr/bin / env node

const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const { buildChangelogManifest } = require('../src/lib/changelog-utils');

function updatePackageJsonVersion(version) {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent);

  if (packageJson.version === version) {
    console.log(`📦 package.json 版本保持 ${version}`);
    return;
  }

  packageJson.version = version;
  fs.writeFileSync(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    'utf8',
  );
  console.log(`📦 已同步 package.json 版本: ${version}`);
}

async function formatJsonFileContent(outputPath, data) {
  const prettierConfig = (await prettier.resolveConfig(outputPath)) || {};

  return await prettier.format(`${JSON.stringify(data, null, 2)}\n`, {
    ...prettierConfig,
    filepath: outputPath,
  });
}

async function main() {
  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG');
    const outputPath = path.join(process.cwd(), 'public/changelog.json');

    console.log('正在读取 CHANGELOG 文件...');
    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');

    console.log('正在解析 CHANGELOG 内容...');
    const changelogData = buildChangelogManifest(changelogContent);

    if (changelogData.entries.length === 0) {
      console.error('❌ 未在 CHANGELOG 中找到任何版本');
      process.exit(1);
    }

    if (changelogData.errors.length > 0) {
      console.error('❌ CHANGELOG 校验失败:');
      changelogData.errors.forEach((error) => {
        console.error(`   - ${error}`);
      });
      process.exit(1);
    }

    const latestVersion = changelogData.latestVersion;
    console.log(`🔢 最新版本: ${latestVersion}`);

    console.log('正在生成 changelog.json...');
    const jsonContent = await formatJsonFileContent(outputPath, {
      latestVersion: changelogData.latestVersion,
      entries: changelogData.entries,
    });

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, jsonContent, 'utf-8');
    updatePackageJsonVersion(latestVersion);

    console.log(`✅ 成功生成 ${outputPath}`);
    console.log(`📊 版本统计:`);
    changelogData.entries.forEach((version) => {
      console.log(
        `   ${version.version} (${version.date}): +${version.added.length} ~${version.changed.length} !${version.fixed.length}`,
      );
    });

    console.log('\n🎉 转换完成!');
  } catch (error) {
    console.error('❌ 转换失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
