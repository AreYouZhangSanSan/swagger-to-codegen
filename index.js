// index.js
import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import prettier from 'prettier';
import { loadSwagger, groupByTag, getAllSchemas } from './lib/parser.js';
import { generateApiFile, generateTypeFile } from './lib/generator.js';

program
  .name('swagger-to-api')
  .description('从 Swagger URL 自动生成前端 API 和类型定义')
  .version('1.0.0')
  .requiredOption('-s, --swagger <url>', 'Swagger 文档的 URL')
  .option('-o, --output <dir>', '输出目录', './src/api')
  .option('-m, --module <tag>', '指定模块的 tag（不指定则生成全部）')
  .parse();

const { swagger, output, module: targetModule } = program.opts();

async function main() {
  console.log(`🚀 正在加载 Swagger: ${swagger}`);
  const swaggerDoc = await loadSwagger(swagger);

  const groups = groupByTag(swaggerDoc);
  const schemas = getAllSchemas(swaggerDoc);

  const tags = targetModule ? [targetModule] : Object.keys(groups);
  if (tags.length === 0) {
    console.log(`❌ 未找到任何接口。`);
    return;
  }

  // 确保输出目录存在
  const apiDir = path.join(output, 'modules');
  const typesDir = path.join(output, 'types');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.mkdirSync(typesDir, { recursive: true });

  const prettierConfig = await prettier.resolveConfig(process.cwd());

  // 先为每个目标 tag 生成 API 文件，收集所有用到的类型
  const allUsedTypes = new Set();
  for (const tag of tags) {
    const endpoints = groups[tag];
    if (!endpoints || endpoints.length === 0) {
      console.log(`⚠️  未找到模块 "${tag}"，跳过。`);
      continue;
    }
    const { code: apiCode, fileName, usedTypes } = generateApiFile(tag, endpoints, schemas);
    usedTypes.forEach(t => allUsedTypes.add(t));
    const formattedApi = await prettier.format(apiCode, {
      ...prettierConfig,
      parser: 'typescript',
    });
    const apiFilePath = path.join(apiDir, `${fileName}.ts`);
    fs.writeFileSync(apiFilePath, formattedApi);
    console.log(`✅ API 文件已生成: ${apiFilePath}`);
  }

  // 只生成 API 文件中实际引用的类型
  const typeCode = generateTypeFile(schemas, allUsedTypes);
  const formattedType = await prettier.format(typeCode, {
    ...prettierConfig,
    parser: 'typescript',
  });
  const typeFilePath = path.join(typesDir, 'api.d.ts');
  fs.writeFileSync(typeFilePath, formattedType);
  console.log(`✅ 类型文件已生成: ${typeFilePath}`);

  console.log(`🎉 全部完成！`);
}

main().catch(err => {
  console.error(`❌ 错误:`, err.message);
  process.exit(1);
});
