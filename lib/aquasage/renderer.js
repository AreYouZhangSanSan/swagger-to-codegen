import { deriveApiModule, toPascalCase } from "./planner.js";

function quote(value) {
  return JSON.stringify(value);
}

function placementOf(plan) {
  if (plan.placement) return plan.placement;
  const slug = plan.resource.slug;
  const namespace = plan.resource.namespace;
  const module = deriveApiModule(plan.resource.basePath);
  const serviceGroup = module || "engineering-catalog";
  const configGroup = module || "engineering";
  const typeNamespace = module ? toPascalCase(module) : "EngineeringCatalog";
  return {
    viewBase: `src/views/knowledge-engineering/${module || "engineering-catalog"}/${slug}`,
    serviceFile: `src/service/api/${serviceGroup}/${slug}.ts`,
    serviceImport: `@/service/api/${serviceGroup}/${slug}`,
    requestImport: "../../request",
    attachmentServiceImport: "@/service/api/engineering-catalog/attachment",
    typeFile: `src/typings/api/${serviceGroup}/${lowerFirst(namespace)}.d.ts`,
    typeNamespace,
    typeQualifiedName: `Api.${typeNamespace}.${namespace}`,
    configFile: `src/config/${configGroup}/${slug}-fields.ts`,
    configImport: `@/config/${configGroup}/${slug}-fields`,
    componentPrefix: `${typeNamespace}${namespace}`,
  };
}

export function renderAquaSageApiFiles(plan) {
  const placement = placementOf(plan);
  return {
    [placement.serviceFile]: renderService(plan),
    [placement.typeFile]: renderTypes(plan),
  };
}

export function renderAquaSagePageFiles(plan) {
  const placement = placementOf(plan);
  const baseView = placement.viewBase;
  const files = {
    [placement.configFile]: renderFields(plan),
    [`${baseView}/list/index.vue`]: renderListPage(plan),
    [`${baseView}/detail/index.vue`]: renderDetailPage(plan),
  };
  if (plan.attachment.enabled)
    files[`${baseView}/attachment/index.vue`] = renderAttachmentPage(plan);
  return files;
}

export function renderAquaSageFiles(plan) {
  return {
    ...renderAquaSageApiFiles(plan),
    ...renderAquaSagePageFiles(plan),
  };
}

function renderService(plan) {
  const { operations, functionNames } = plan;
  const placement = placementOf(plan);
  const ns = placement.typeQualifiedName;
  const blocks = [`import { request } from '${placement.requestImport}'`, ""];

  if (operations.list) {
    blocks.push(`/** 获取${plan.resource.title}列表（分页） */`);
    blocks.push(
      `export function ${functionNames.list}(params: ${ns}.SearchParams) {`,
    );
    blocks.push(
      `  return request<App.Service.Response<${ns}.PagedData<${ns}.Item>>>({`,
    );
    blocks.push(...requestConfigLines(operations.list, "params", "params"));
    blocks.push("  })", "}", "");
  }

  if (operations.detail) {
    const detailParam = plan.form.detailParam;
    const paramType = detailParam?.type === "number" ? "number" : "string";
    blocks.push(`/** 获取${plan.resource.title}详情 */`);
    blocks.push(
      `export function ${functionNames.detail}(params: { ${detailParam?.name || "id"}: ${paramType} }) {`,
    );
    blocks.push(`  return request<App.Service.Response<${ns}.DetailData>>({`);
    blocks.push(...requestConfigLines(operations.detail, "params", "params"));
    blocks.push("  })", "}", "");
  }

  if (operations.create) {
    blocks.push(`/** 新增${plan.resource.title} */`);
    blocks.push(
      `export function ${functionNames.create}(data: ${ns}.SavePayload) {`,
    );
    blocks.push(`  return request<App.Service.Response<${ns}.Item>>({`);
    blocks.push(...requestConfigLines(operations.create, "data", "data"));
    blocks.push("  })", "}", "");
  }

  if (operations.update) {
    blocks.push(`/** 修改${plan.resource.title} */`);
    blocks.push(
      `export function ${functionNames.update}(data: ${ns}.SavePayload) {`,
    );
    blocks.push(`  return request<App.Service.Response<${ns}.Item>>({`);
    blocks.push(...requestConfigLines(operations.update, "data", "data"));
    blocks.push("  })", "}", "");
  }

  if (operations.delete) {
    const deleteSchema = requestSchema(operations.delete);
    const hasBody = Boolean(deleteSchema);
    blocks.push(`/** 删除${plan.resource.title} */`);
    blocks.push(
      `export function ${functionNames.delete}(data: ${ns}.DeletePayload) {`,
    );
    blocks.push(`  return request<App.Service.Response<boolean | null>>({`);
    blocks.push(
      ...requestConfigLines(
        operations.delete,
        "data",
        hasBody ? "data" : "params",
      ),
    );
    blocks.push("  })", "}", "");
  }

  for (const extra of plan.extraOperations || []) {
    const typeBase = extraTypeBase(extra);
    const bodyFields = extra.bodyFields || [];
    const paramFields = [
      ...(extra.pathFields || []),
      ...(extra.queryFields || []),
    ];
    blocks.push(`/** ${extra.summary || extra.action} */`);
    if (bodyFields.length > 0) {
      blocks.push(
        `export function ${extraFunctionName(plan, extra)}(data: ${ns}.${typeBase}Payload) {`,
      );
      blocks.push(
        `  return request<App.Service.Response<${extraResponseType(ns, extra)}>>({`,
      );
      blocks.push(...requestConfigLines(extra, "data", "data"));
    } else if (paramFields.length > 0) {
      blocks.push(
        `export function ${extraFunctionName(plan, extra)}(data: ${ns}.${typeBase}Params) {`,
      );
      blocks.push(
        `  return request<App.Service.Response<${extraResponseType(ns, extra)}>>({`,
      );
      blocks.push(...requestConfigLines(extra, "data", "params"));
    } else {
      blocks.push(`export function ${extraFunctionName(plan, extra)}() {`);
      blocks.push(
        `  return request<App.Service.Response<${extraResponseType(ns, extra)}>>({`,
      );
      blocks.push(...requestConfigLines(extra, "data", "params"));
    }
    blocks.push("  })", "}", "");
  }

  return `${blocks.join("\n").trim()}\n`;
}

function requestConfigLines(operation, variable, placement) {
  const method = operation.method.toLowerCase();
  const pathParameters = (operation.parameters || []).filter(
    (parameter) => parameter.in === "path",
  );
  let url = operation.path;
  for (const parameter of pathParameters) {
    url = url.replace(
      `{${parameter.name}}`,
      `\${${variable}.${parameter.name}}`,
    );
  }
  const urlExpression = pathParameters.length ? `\`${url}\`` : quote(url);
  const lines = [`    url: ${urlExpression},`, `    method: ${quote(method)}`];
  if (placement === "params") lines[lines.length - 1] += ",";
  if (placement === "params") lines.push(`    params: ${variable}`);
  if (placement === "data") {
    lines[lines.length - 1] += ",";
    lines.push(`    data: ${variable}`);
  }
  return lines;
}

function renderTypes(plan) {
  const ns = plan.resource.namespace;
  const placement = placementOf(plan);
  const itemFields = plan.list.itemFields.filter(
    (field) => field.name !== "id",
  );
  const detailFields = plan.form.detailFields.length
    ? plan.form.detailFields
    : plan.list.itemFields;
  const deleteFields = schemaFieldPlans(
    requestSchema(plan.operations.delete),
    plan,
  );
  const lines = [
    "declare namespace Api {",
    `  namespace ${placement.typeNamespace} {`,
    `    namespace ${ns} {`,
    `      /** ${plan.resource.title}列表项 */`,
    "      interface Item {",
    "        id: string | number",
  ];
  lines.push(...renderInterfaceFields(itemFields, 8));
  lines.push("        [key: string]: unknown", "      }", "");
  lines.push(
    `      /** ${plan.resource.title}详情 */`,
    "      interface DetailData extends Record<string, unknown> {",
  );
  lines.push(...renderInterfaceFields(detailFields, 8));
  lines.push("      }", "");
  lines.push(
    "      interface PagedData<T> {",
    "        current: number",
    "        size: number",
    "        total: number",
    "        total_page: number",
    "        data: T[]",
    "      }",
    "",
  );
  lines.push(
    "      interface SearchParams extends Common.CommonSearchParams {",
    "        order?: string",
    "        order_by?: string",
  );
  lines.push(...renderInterfaceFields(plan.list.searchFields, 8));
  lines.push("      }", "");
  lines.push("      interface SavePayload {");
  lines.push(...renderInterfaceFields(plan.form.fields, 8));
  lines.push("        [key: string]: unknown", "      }", "");
  lines.push("      interface DeletePayload {");
  if (deleteFields.length)
    lines.push(...renderInterfaceFields(deleteFields, 8));
  else lines.push("        id: string | number");
  lines.push("      }", "");
  lines.push(...renderExtraTypeLines(plan));
  lines.push("    }", "  }", "}", "");
  return lines.join("\n");
}

function renderExtraTypeLines(plan) {
  const lines = [];
  for (const extra of plan.extraOperations || []) {
    const base = extraTypeBase(extra);
    const paramFields = [
      ...(extra.pathFields || []),
      ...(extra.queryFields || []),
    ];
    if (paramFields.length > 0) {
      lines.push(`      /** ${extra.summary || extra.action} 参数 */`);
      lines.push(`      interface ${base}Params {`);
      lines.push(...renderInterfaceFields(paramFields, 8));
      lines.push("      }", "");
    }
    if ((extra.bodyFields || []).length > 0) {
      lines.push(`      /** ${extra.summary || extra.action} 提交数据 */`);
      lines.push(`      interface ${base}Payload {`);
      lines.push(...renderInterfaceFields(extra.bodyFields, 8));
      lines.push("        [key: string]: unknown", "      }", "");
    }
    const itemFields = extra.response?.itemFields || [];
    if (itemFields.length > 0) {
      lines.push(`      /** ${extra.summary || extra.action} 响应项 */`);
      lines.push(`      interface ${base}Item {`);
      lines.push(...renderInterfaceFields(itemFields, 8));
      lines.push("      }", "");
    }
  }
  return lines;
}

function renderInterfaceFields(fields, spaces) {
  const indent = " ".repeat(spaces);
  return uniqueFields(fields).map((field) => {
    const optional = field.required ? "" : "?";
    return `${indent}${safeProperty(field.name)}${optional}: ${fieldType(field)}`;
  });
}

function renderFields(plan) {
  const extraFieldLists = (plan.extraOperations || []).map((extra) => [
    ...(extra.pathFields || []),
    ...(extra.queryFields || []),
    ...(extra.bodyFields || []),
  ]);
  const hasTree =
    plan.form.fields.some((field) => field.widget === "tree") ||
    extraFieldLists.some((fields) =>
      fields.some((field) => field.widget === "tree"),
    );
  const ns = plan.resource.namespace;
  const variable = `${lowerFirst(ns)}Fields`;
  const lines = [];
  if (hasTree)
    lines.push("import { fetchAreaTree } from '@/service/api/system'");
  lines.push(
    "import type { FormField, FormFieldGroup } from '@/components/common/engineering-form/types'",
    "",
  );
  lines.push(`export const ${variable}: FormField[] = [`);
  for (const field of plan.form.fields) {
    lines.push(renderFormField(field));
  }
  lines.push("]", "");

  const groupVariable = `${lowerFirst(ns)}FieldGroups`;
  const groups = chunk(
    plan.form.fields.map((field) => field.name),
    12,
  );
  lines.push(`export const ${groupVariable}: FormFieldGroup[] = [`);
  groups.forEach((names, index) => {
    const title = index === 0 ? "基本信息" : `扩展信息${index}`;
    lines.push(
      "  {",
      `    title: ${quote(title)},`,
      `    anchor: ${quote(index === 0 ? "basic-info" : `extra-info-${index}`)},`,
    );
    lines.push(
      `    fields: ${variable}.filter(field => ${JSON.stringify(names)}.includes(field.key))`,
    );
    lines.push("  },");
  });
  lines.push("]", "");

  (plan.extraOperations || []).forEach((extra, index) => {
    const fields = extraFieldLists[index];
    if (fields.length === 0) return;
    lines.push(`/** ${extra.summary || extra.action} 字段 */`);
    lines.push(`export const ${lowerFirst(extra.action)}Fields: FormField[] = [`);
    for (const field of fields) lines.push(renderFormField(field));
    lines.push("]", "");
  });
  return lines.join("\n");
}

function renderFormField(field) {
  const lines = [
    "  {",
    `    key: ${quote(field.name)},`,
    `    label: ${quote(field.label)},`,
    `    type: ${quote(field.widget)},`,
    `    span: ${field.span || 8},`,
  ];
  if (field.required) lines.push("    required: true,");
  if (field.hideOnAdd) lines.push("    hideOnAdd: true,");
  if (field.enum?.length) {
    lines.push(
      `    options: ${JSON.stringify(field.enum.map((value) => ({ label: String(value), value })))},`,
    );
  }
  if (field.widget === "tree" && field.name === "city_code") {
    lines.push(
      "    treeApi: () => fetchAreaTree({ area_code: '330000' }),",
      "    syncLabelKey: 'city',",
    );
  }
  if (field.widget === "tree" && field.name === "area_code") {
    lines.push(
      "    treeApi: parentValue => fetchAreaTree(parentValue ? { area_code: String(parentValue) } : {}),",
      "    parentKey: 'city_code',",
      "    syncLabelKey: 'area_name',",
    );
  }
  if (field.widget === "table" && field.itemFields?.length) {
    lines.push(
      `    columns: ${JSON.stringify(field.itemFields.map((item) => ({ title: item.label, key: item.name, editable: true })))},`,
    );
  }
  const action =
    field.widget === "select" ||
    field.widget === "tree" ||
    field.widget === "date" ||
    field.widget === "datetime"
      ? "请选择"
      : "请输入";
  lines.push(`    placeholder: ${quote(`${action}${field.label}`)}`);
  lines.push("  },");
  return lines.join("\n");
}

function renderListPage(plan) {
  const ns = plan.resource.namespace;
  const placement = placementOf(plan);
  const typeName = placement.typeQualifiedName;
  const fieldsVariable = `${lowerFirst(ns)}Fields`;
  const searchFields = plan.list.searchFields;
  const importComponents = new Set([
    "NButton",
    "NCard",
    "NDataTable",
    "NForm",
    "NFormItemGi",
    "NGrid",
    "NSpace",
  ]);
  if (searchFields.some((field) => field.widget === "number"))
    importComponents.add("NInputNumber");
  if (searchFields.some((field) => field.widget === "select"))
    importComponents.add("NSelect");
  if (
    searchFields.some((field) => !["number", "select"].includes(field.widget))
  )
    importComponents.add("NInput");
  if (plan.operations.create) importComponents.add("NModal");
  if (plan.operations.delete) importComponents.add("NPopconfirm");
  if (plan.operations.create || plan.operations.delete)
    importComponents.add("useMessage");

  const serviceFunctions = [
    plan.functionNames.list,
    plan.functionNames.create,
    plan.functionNames.delete,
  ].filter(Boolean);
  const needsRouter = Boolean(
    plan.operations.detail || plan.attachment.enabled,
  );
  const searchKeys = searchFields.map((field) => quote(field.name)).join(", ");
  const lines = [
    '<script setup lang="tsx">',
    "import { reactive, ref } from 'vue'",
    needsRouter ? "import { useRouter } from 'vue-router'" : "",
    `import { ${[...importComponents].sort().join(", ")} } from 'naive-ui'`,
    "import type { FlatResponseData } from '@sa/axios'",
    `import { ${fieldsVariable} } from '${placement.configImport}'`,
    `import { ${serviceFunctions.join(", ")} } from '${placement.serviceImport}'`,
    plan.operations.create
      ? "import EngineeringForm from '@/components/common/engineering-form/index.vue'"
      : "",
    "import TopSearchTool from '@/components/advanced/top-search-tool.vue'",
    "import { useNaivePaginatedTable, useTableMaxHeight } from '@/hooks/common/table'",
    "",
    `defineOptions({ name: '${placement.componentPrefix}List' })`,
    "",
    `type SearchParams = ${typeName}.SearchParams`,
    `type Row = ${typeName}.Item`,
    `type ListResponse = FlatResponseData<App.Service.Response<${typeName}.PagedData<Row>>, App.Service.Response<${typeName}.PagedData<Row>>>`,
    "",
    plan.operations.create || plan.operations.delete
      ? "const message = useMessage()"
      : "",
    needsRouter ? "const router = useRouter()" : "",
    "const searchParams = reactive<SearchParams>({",
    "  current: 1,",
    "  size: 15,",
    "  order: 'id',",
    "  order_by: 'asc',",
    ...searchFields.map(
      (field) =>
        `  ${safeProperty(field.name)}: ${literal(field.defaultValue)},`,
    ),
    "})",
    "const checkedRowKeys = ref<Array<string | number>>([])",
    "const tableMaxHeight = useTableMaxHeight()",
    plan.operations.create ? "const addModalVisible = ref(false)" : "",
    "",
    "function buildTrimmedQuery(keys: string[]) {",
    "  const result = { ...searchParams } as Record<string, unknown>",
    "  for (const key of keys) {",
    "    const value = result[key]",
    "    if (value === '' || value === null || value === undefined) delete result[key]",
    "  }",
    "  return result as SearchParams",
    "}",
    "",
    "function handleReset(reload: (page: number) => unknown) {",
    "  Object.assign(searchParams, {",
    "    current: 1,",
    "    size: 15,",
    "    order: 'id',",
    "    order_by: 'asc',",
    ...searchFields.map(
      (field) =>
        `    ${safeProperty(field.name)}: ${literal(field.defaultValue)},`,
    ),
    "  })",
    "  reload(1)",
    "}",
    "",
  ];

  if (plan.operations.detail) {
    lines.push(
      "function handleEdit(row: Row) {",
      `  router.push('${plan.resource.routeBase}/detail?id=' + encodeURIComponent(String(row.${safeProperty(plan.form.detailRefField)})))`,
      "}",
      "",
    );
  }
  if (plan.attachment.enabled) {
    lines.push(
      "function handleAttachment(row: Row) {",
      `  router.push('${plan.resource.routeBase}/attachment?primary_ref=' + encodeURIComponent(String(row.${safeProperty(plan.attachment.refField)} || '')))`,
      "}",
      "",
    );
  }
  if (plan.operations.delete) {
    lines.push(
      "async function handleDelete(id: string | number) {",
      `  const { error } = await ${plan.functionNames.delete}({ id })`,
      "  if (error) return",
      "  message.success('删除成功')",
      "  await getData()",
      "}",
      "",
      "async function handleBatchDelete() {",
      `  const results = await Promise.all(checkedRowKeys.value.map(id => ${plan.functionNames.delete}({ id })))`,
      "  if (results.some(result => result.error)) return",
      "  message.success('批量删除成功')",
      "  checkedRowKeys.value = []",
      "  await getData()",
      "}",
      "",
    );
  }
  if (plan.operations.create) {
    lines.push(
      "function handleAdd() {",
      "  addModalVisible.value = true",
      "}",
      "",
      "async function handleSubmitAdd(data: Record<string, unknown>) {",
      `  const { error } = await ${plan.functionNames.create}(data as ${typeName}.SavePayload)`,
      "  if (error) return",
      "  message.success('新增成功')",
      "  addModalVisible.value = false",
      "  await getData()",
      "}",
      "",
    );
  }

  lines.push(
    "const tableData = useNaivePaginatedTable<ListResponse, Row>({",
    `  api: () => ${plan.functionNames.list}(buildTrimmedQuery([${searchKeys}])),`,
    "  transform: response => {",
    "    const payload = response.data?.data",
    "    if (!response.error && payload) {",
    "      return { data: payload.data || [], pageNum: payload.current, pageSize: payload.size, total: payload.total }",
    "    }",
    "    return { data: [], pageNum: 1, pageSize: 15, total: 0 }",
    "  },",
    "  onPaginationParamsChange: ({ page, pageSize }) => {",
    "    searchParams.current = page ?? 1",
    "    searchParams.size = pageSize ?? 15",
    "  },",
    "  paginationProps: { pageSize: searchParams.size, pageSizes: [15, 20, 30, 50] },",
    "  showTotal: true,",
    "  columns: () => [",
    "    { type: 'selection', align: 'center', width: 48, fixed: 'left' },",
    "    { key: 'index', title: '序号', align: 'center', width: 64, fixed: 'left', render: (_row, index) => (searchParams.current - 1) * searchParams.size + index + 1 },",
    ...plan.list.tableFields.map(
      (field) =>
        `    { key: ${quote(field.name)}, title: ${quote(field.label)}, align: 'center', minWidth: 140 },`,
    ),
    renderOperationColumn(plan),
    "  ]",
    "})",
    "",
    "const { columns, columnChecks, data, loading, pagination, getData, getDataByPage } = tableData",
    "</script>",
    "",
    "<template>",
    '  <div class="h-full flex-col-stretch gap-16px overflow-hidden">',
    "    <TopSearchTool>",
    "      <template #fields>",
    '        <NForm :show-feedback="false" label-placement="left" :label-width="90">',
    '          <NGrid :cols="24" :x-gap="24" :y-gap="12">',
    ...searchFields.flatMap((field) => renderSearchField(field)),
    "          </NGrid>",
    "        </NForm>",
    "      </template>",
    "      <template #actions>",
    '        <NSpace :wrap="false">',
    '          <NButton @click="handleReset(getDataByPage)">重置</NButton>',
    '          <NButton type="primary" @click="getDataByPage(1)">搜索</NButton>',
    "        </NSpace>",
    "      </template>",
    "    </TopSearchTool>",
    "",
    `    <NCard title="${plan.resource.title}列表" :bordered="false" size="small" class="flex-1-hidden card-wrapper">`,
    "      <template #header-extra>",
    "        <TableHeaderOperation",
    '          v-model:columns="columnChecks"',
    plan.operations.delete
      ? '          :disabled-delete="checkedRowKeys.length === 0"'
      : "          disabled-delete",
    '          :loading="loading"',
    '          @refresh="getData"',
    "        >",
    "          <template #default>",
    plan.operations.create
      ? '            <NButton size="small" ghost type="primary" @click="handleAdd">新增</NButton>'
      : "",
    plan.operations.delete
      ? '            <NPopconfirm @positive-click="handleBatchDelete"><template #trigger><NButton size="small" ghost type="error" :disabled="checkedRowKeys.length === 0">批量删除</NButton></template>确认删除吗？</NPopconfirm>'
      : "",
    "          </template>",
    "        </TableHeaderOperation>",
    "      </template>",
    "      <NDataTable",
    '        v-model:checked-row-keys="checkedRowKeys"',
    '        :columns="columns"',
    '        :data="data"',
    '        size="small"',
    '        :max-height="tableMaxHeight"',
    `        :scroll-x="${Math.max(1000, plan.list.tableFields.length * 150 + 400)}"`,
    '        :loading="loading"',
    "        remote",
    `        :row-key="row => row.${plan.list.rowKey}"`,
    '        :pagination="pagination"',
    "      />",
    "    </NCard>",
    plan.operations.create ? renderAddModal(plan, fieldsVariable) : "",
    "  </div>",
    "</template>",
    "",
    "<style scoped>",
    ".add-modal :deep(.n-card__content) { padding: 0; }",
    ".add-modal-content { height: 70vh; overflow: hidden; }",
    "</style>",
    "",
  );

  return lines
    .filter((line) => line !== "")
    .join("\n")
    .replace(/<\/script>\n<template>/, "</script>\n\n<template>");
}

function renderOperationColumn(plan) {
  const buttons = [];
  if (plan.operations.detail)
    buttons.push(
      '<NButton type="primary" ghost size="small" onClick={() => handleEdit(row)}>编辑</NButton>',
    );
  if (plan.attachment.enabled)
    buttons.push(
      '<NButton type="info" ghost size="small" onClick={() => handleAttachment(row)}>附件</NButton>',
    );
  if (plan.operations.delete) {
    buttons.push(
      '<NPopconfirm onPositiveClick={() => handleDelete(row.id)}>{{ default: () => \'确认删除吗？\', trigger: () => <NButton type="error" ghost size="small">删除</NButton> }}</NPopconfirm>',
    );
  }
  if (!buttons.length) return "";
  return `    { key: 'operate', title: '操作', align: 'center', width: ${buttons.length * 90 + 40}, fixed: 'right', render: row => <div class=\"flex-center gap-8px\">${buttons.join("")}</div> },`;
}

function renderSearchField(field) {
  const model = `searchParams.${field.name}`;
  const open = `            <NFormItemGi :span="6" label="${field.label}" path="${field.name}">`;
  let input;
  if (field.widget === "number")
    input = `              <NInputNumber v-model:value="${model}" clearable />`;
  else if (field.widget === "select")
    input = `              <NSelect v-model:value="${model}" :options='${JSON.stringify(field.enum.map((value) => ({ label: String(value), value })))}' clearable />`;
  else input = `              <NInput v-model:value="${model}" clearable />`;
  return [open, input, "            </NFormItemGi>"];
}

function renderAddModal(plan, fieldsVariable) {
  return `
    <NModal
      v-model:show="addModalVisible"
      preset="card"
      title="新增${plan.resource.title}"
      :mask-closable="false"
      class="add-modal"
      :style="{ width: '90vw', maxWidth: '1200px' }"
    >
      <div class="add-modal-content">
        <EngineeringForm
          :is-add="true"
          :form-data="${fieldsVariable}"
          :submit="handleSubmitAdd"
          :config="{ showFooter: true, submitText: '保存', cancelText: '取消', labelPlacement: 'left', labelWidth: 130 }"
          @cancel="addModalVisible = false"
        />
      </div>
    </NModal>`;
}

function renderDetailPage(plan) {
  const ns = plan.resource.namespace;
  const placement = placementOf(plan);
  const typeName = placement.typeQualifiedName;
  const variable = lowerFirst(ns);
  const availableFunctions = [
    plan.functionNames.create,
    plan.functionNames.update,
    plan.functionNames.detail,
  ].filter(Boolean);
  if (
    !plan.operations.create &&
    !plan.operations.update &&
    !plan.operations.detail
  ) {
    return `<template>\n  <div class="h-full">${plan.resource.title}暂无详情接口</div>\n</template>\n`;
  }
  const detailParam = plan.form.detailParam?.name || "id";
  const detailParamCast =
    plan.form.detailParam?.type === "number"
      ? "Number(params.id)"
      : "String(params.id)";
  const lines = [
    '<script setup lang="ts">',
    "import { computed } from 'vue'",
    "import { useRoute, useRouter } from 'vue-router'",
    "import { useMessage } from 'naive-ui'",
    `import { ${variable}FieldGroups, ${variable}Fields } from '${placement.configImport}'`,
    `import { ${availableFunctions.join(", ")} } from '${placement.serviceImport}'`,
    "import EngineeringForm from '@/components/common/engineering-form/index.vue'",
    "",
    `defineOptions({ name: '${placement.componentPrefix}Detail' })`,
    "",
    "const route = useRoute()",
    "const router = useRouter()",
    "const message = useMessage()",
    "const docId = computed(() => route.query.id as string | undefined)",
    "const isAdd = computed(() => !docId.value)",
    `const pageTitle = computed(() => (isAdd.value ? '新增${plan.resource.title}' : '编辑${plan.resource.title}'))`,
    "",
  ];
  if (plan.operations.detail) {
    lines.push(
      "async function fetchDetailForForm(params: { id: string | number }) {",
      `  const response = await ${plan.functionNames.detail}({ ${detailParam}: ${detailParamCast} })`,
      "  if (response.error) throw response.error",
      "  return { data: response.data as unknown as Record<string, unknown> }",
      "}",
      "",
    );
  }
  lines.push("async function handleSubmit(data: Record<string, unknown>) {");
  if (plan.operations.create && plan.operations.update) {
    lines.push(
      `  const response = isAdd.value ? await ${plan.functionNames.create}(data as ${typeName}.SavePayload) : await ${plan.functionNames.update}(data as ${typeName}.SavePayload)`,
    );
  } else if (plan.operations.update) {
    lines.push(
      `  const response = await ${plan.functionNames.update}(data as ${typeName}.SavePayload)`,
    );
  } else if (plan.operations.create) {
    lines.push(
      `  const response = await ${plan.functionNames.create}(data as ${typeName}.SavePayload)`,
    );
  } else {
    lines.push("  message.warning('当前资源没有保存接口')", "  return");
  }
  if (plan.operations.create || plan.operations.update) {
    lines.push(
      "  if (response.error) return",
      "  message.success(isAdd.value ? '新增成功' : '修改成功')",
      `  await router.push('${plan.resource.routeBase}/list')`,
    );
  }
  lines.push(
    "}",
    "",
    "function handleCancel() {",
    `  router.push('${plan.resource.routeBase}/list')`,
    "}",
    "</script>",
    "",
    "<template>",
    '  <div class="detail-page">',
    "    <EngineeringForm",
    '      :is-add="isAdd"',
    '      :title="pageTitle"',
    `      :form-data="${variable}Fields"`,
    '      :edit-id="docId"',
    '      :submit="handleSubmit"',
  );
  if (plan.operations.detail)
    lines.push('      :detail-api="fetchDetailForForm"');
  lines.push(
    `      :config="{ groups: ${variable}FieldGroups, showFooter: true, submitText: '保存', cancelText: '取消', labelPlacement: 'left', labelWidth: 130 }"`,
    '      @cancel="handleCancel"',
    "    />",
    "  </div>",
    "</template>",
    "",
    "<style scoped>",
    ".detail-page { height: 100%; padding: 16px; box-sizing: border-box; overflow: hidden; }",
    "</style>",
    "",
  );
  return lines.join("\n");
}

function renderAttachmentPage(plan) {
  const ns = plan.resource.namespace;
  const placement = placementOf(plan);
  return `<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NCard, NDataTable, NInput, NModal, NPopconfirm, NSpace, NUpload, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import {
  fetchCreateAttachment,
  fetchDeleteAttachment,
  fetchGetAttachmentList
} from '${placement.attachmentServiceImport}'

defineOptions({ name: '${placement.componentPrefix}Attachment' })

const route = useRoute()
const message = useMessage()
const primaryRef = computed(() => String(route.query.primary_ref || ''))
const loading = ref(false)
const uploadVisible = ref(false)
const uploadFiles = ref<UploadFileInfo[]>([])
const fileName = ref('')
const data = ref<Api.EngineeringCatalog.Attachment.Item[]>([])

const columns = [
  { key: 'file_name', title: '文件名称', minWidth: 220 },
  { key: 'file_type', title: '文件类型', width: 120 },
  { key: 'file_size', title: '文件大小', width: 120 },
  { key: 'created_at', title: '上传时间', width: 180 },
  {
    key: 'operate',
    title: '操作',
    width: 180,
    render: (row: Api.EngineeringCatalog.Attachment.Item) => (
      <NSpace>
        <NButton type="primary" ghost size="small" onClick={() => handlePreview(row)}>预览</NButton>
        <NPopconfirm onPositiveClick={() => handleDelete(row)}>
          {{
            default: () => '确认删除吗？',
            trigger: () => <NButton type="error" ghost size="small">删除</NButton>
          }}
        </NPopconfirm>
      </NSpace>
    )
  }
]

async function loadData() {
  if (!primaryRef.value) {
    data.value = []
    return
  }
  loading.value = true
  try {
    const response = await fetchGetAttachmentList({ primary_ref: primaryRef.value })
    if (response.error) return
    const payload = response.data?.data as unknown
    if (Array.isArray(payload)) data.value = payload as Api.EngineeringCatalog.Attachment.Item[]
    else if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
      data.value = (payload as { data: Api.EngineeringCatalog.Attachment.Item[] }).data
    } else data.value = []
  } finally {
    loading.value = false
  }
}

function handleAdd() {
  uploadFiles.value = []
  fileName.value = ''
  uploadVisible.value = true
}

async function handleUpload() {
  const file = uploadFiles.value[0]?.file
  if (!file || !primaryRef.value) {
    message.error('请选择文件')
    return
  }
  const formData = new FormData()
  formData.append('module_name', ${quote(plan.resource.slug)})
  formData.append('primary_ref', primaryRef.value)
  formData.append('file_name', fileName.value || file.name)
  formData.append('file', file)
  const response = await fetchCreateAttachment(formData)
  if (response.error) return
  message.success('上传成功')
  uploadVisible.value = false
  await loadData()
}

async function handleDelete(row: Api.EngineeringCatalog.Attachment.Item) {
  const response = await fetchDeleteAttachment({ id: Number(row.id) })
  if (response.error) return
  message.success('删除成功')
  await loadData()
}

function handlePreview(row: Api.EngineeringCatalog.Attachment.Item) {
  if (row.file_url) window.open(row.file_url, '_blank', 'noopener,noreferrer')
}

onMounted(loadData)
</script>

<template>
  <div class="h-full flex-col-stretch gap-16px overflow-hidden">
    <NCard title="${plan.resource.title}附件列表" :bordered="false" size="small" class="flex-1-hidden card-wrapper">
      <template #header-extra>
        <NSpace>
          <NButton type="primary" @click="handleAdd">新增附件</NButton>
          <NButton :loading="loading" @click="loadData">刷新</NButton>
        </NSpace>
      </template>
      <NDataTable :columns="columns" :data="data" :loading="loading" :row-key="row => row.id" />
    </NCard>

    <NModal v-model:show="uploadVisible" preset="card" title="新增附件" style="width: 560px">
      <NSpace vertical>
        <NInput v-model:value="fileName" placeholder="文件名称（可选）" />
        <NUpload v-model:file-list="uploadFiles" :default-upload="false" :max="1">
          <NButton>选择文件</NButton>
        </NUpload>
        <NSpace justify="end">
          <NButton @click="uploadVisible = false">取消</NButton>
          <NButton type="primary" @click="handleUpload">上传</NButton>
        </NSpace>
      </NSpace>
    </NModal>
  </div>
</template>
`;
}

function schemaFieldPlans(schema) {
  if (!schema?.properties) return [];
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties).map(([name, property]) => ({
    name,
    type: property.type || "unknown",
    format: property.format || null,
    enum: property.enum || null,
    required: required.has(name),
    nullable: Boolean(property.nullable),
  }));
}

function requestSchema(operation) {
  const content = operation?.requestBody?.content || {};
  return (
    content["application/json"]?.schema ||
    content["multipart/form-data"]?.schema ||
    Object.values(content)[0]?.schema ||
    null
  );
}

function fieldType(field) {
  let type;
  if (field.enum?.length)
    type = field.enum.map((value) => JSON.stringify(value)).join(" | ");
  else if (field.type === "integer" || field.type === "number") type = "number";
  else if (field.type === "boolean") type = "boolean";
  else if (field.type === "array") type = "unknown[]";
  else if (field.type === "object") type = "Record<string, unknown>";
  else if (field.type === "unknown") type = "unknown";
  else type = "string";
  return field.nullable ? `${type} | null` : type;
}

function uniqueFields(fields) {
  return [...new Map(fields.map((field) => [field.name, field])).values()];
}

function safeProperty(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name);
}

function literal(value) {
  if (value === undefined || value === null) return "undefined";
  return JSON.stringify(value);
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function chunk(values, size) {
  if (values.length === 0) return [[]];
  const result = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

const EXTRA_RESERVED_TYPE_ACTIONS = new Set([
  "Save",
  "Delete",
  "Create",
  "Update",
  "List",
  "Detail",
  "Info",
  "Add",
]);

/** 附加接口动作名与主 CRUD 类型名冲突时加 Extra 后缀 */
function extraTypeBase(extra) {
  return EXTRA_RESERVED_TYPE_ACTIONS.has(extra.action)
    ? `${extra.action}Extra`
    : extra.action;
}

function extraFunctionName(plan, extra) {
  return `fetch${methodWord(extra.method)}Prj${plan.resource.namespace}${extra.action}`;
}

function extraResponseType(ns, extra) {
  const response = extra.response || {};
  const item = response.itemSchema;
  if (item?.properties)
    return `${ns}.${extraTypeBase(extra)}Item${response.isArray ? "[]" : ""}`;
  let primitive = null;
  if (item?.type === "string") primitive = "string";
  else if (item?.type === "integer" || item?.type === "number")
    primitive = "number";
  else if (item?.type === "boolean") primitive = "boolean";
  return primitive ? `${primitive}${response.isArray ? "[]" : ""}` : "unknown";
}

function methodWord(method) {
  return method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
}
