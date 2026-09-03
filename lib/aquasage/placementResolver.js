import fs from "fs/promises";
import path from "path";

const DEFAULT_PARENT_PATH = "/knowledge-engineering/engineering-catalog";
const DEFAULT_SERVICE_GROUP = "engineering-catalog";
const DEFAULT_CONFIG_GROUP = "engineering";
const DEFAULT_TYPE_NAMESPACE = "EngineeringCatalog";

/**
 * 把 OpenAPI 资源计划安装到 zdwp-aquasage-web 的指定父路由。
 * 业务事实仍然来自 planner；本模块只负责目录、导入、路由和参考页面模式。
 */
export async function configureAquaSagePlans(projectRoot, plans, options = {}) {
  const root = path.resolve(projectRoot);
  const reference = options.referenceView
    ? await analyzeReferenceModule(root, options.referenceView)
    : null;
  const parentRoutePath = normalizeRoutePath(
    options.targetParent || DEFAULT_PARENT_PATH,
  );
  const parentRouteName = routeNameFromPath(parentRoutePath);
  const serviceGroup = normalizeGroup(
    options.serviceGroup ||
      reference?.serviceGroup ||
      (parentRoutePath === DEFAULT_PARENT_PATH
        ? DEFAULT_SERVICE_GROUP
        : parentRoutePath.split("/").filter(Boolean).at(-1)),
    "Service 分组",
  );
  const typeGroup = normalizeGroup(
    options.typeGroup || serviceGroup,
    "类型分组",
  );
  const configGroup = normalizeGroup(
    options.configGroup || reference?.configGroup || DEFAULT_CONFIG_GROUP,
    "字段配置分组",
  );
  const typeNamespace = normalizeIdentifier(
    options.typeNamespace ||
      (serviceGroup === DEFAULT_SERVICE_GROUP
        ? DEFAULT_TYPE_NAMESPACE
        : toPascalCase(serviceGroup)),
    "类型命名空间",
  );
  const menuMode = resolveMenuMode(options.menuMode, reference);

  if (options.createParent && !options.targetParent) {
    throw new Error("使用 --create-parent 时必须显式提供 --target-parent");
  }
  if (options.createParent && !options.parentTitle) {
    throw new Error("使用 --create-parent 时必须提供 --parent-title");
  }
  if (options.parentTitle && !options.createParent) {
    throw new Error("--parent-title 只能与 --create-parent 一起使用");
  }
  await validateParentPlacement(root, parentRoutePath, options);

  return plans.map((plan) => {
    const slug = normalizeSlug(plan.resource.slug);
    const resourceRoutePath = `${parentRoutePath}/${slug}`;
    const resourceRouteName = routeNameFromPath(resourceRoutePath);
    const viewBase = `src/views${resourceRoutePath}`;
    const serviceFile = `src/service/api/${serviceGroup}/${slug}.ts`;
    const typeFileName = `${lowerFirst(plan.resource.namespace)}.d.ts`;
    const typeFile = `src/typings/api/${typeGroup}/${typeFileName}`;
    const configFile = `src/config/${configGroup}/${slug}-fields.ts`;
    const activeMenu =
      options.activeMenu ||
      (menuMode === "parent" ? parentRouteName : resourceRouteName);
    const review = [...plan.review];

    if (reference && !reference.pages.detail && plan.operations.detail) {
      review.push(
        `参考模块 ${reference.relativeRoot} 没有 detail 页面；仍按 AquaSage 标准详情页生成`,
      );
    }
    if (reference && !reference.pages.attachment && plan.attachment.enabled) {
      review.push(
        `参考模块 ${reference.relativeRoot} 没有 attachment 页面；仍按 AquaSage 标准附件页生成`,
      );
    }

    return {
      ...plan,
      resource: {
        ...plan.resource,
        slug,
        routeBase: resourceRoutePath,
      },
      placement: {
        version: 1,
        mode: reference ? "reference" : "preset",
        preset: reference ? null : "engineering-catalog",
        reference,
        parentRoutePath,
        parentRouteName,
        resourceRoutePath,
        resourceRouteName,
        viewBase,
        serviceGroup,
        serviceFile,
        serviceImport: `@/service/api/${serviceGroup}/${slug}`,
        requestImport: requestImportFor(serviceFile),
        attachmentServiceImport:
          options.attachmentService ||
          "@/service/api/engineering-catalog/attachment",
        typeGroup,
        typeFile,
        typeNamespace,
        typeQualifiedName: `Api.${typeNamespace}.${plan.resource.namespace}`,
        configGroup,
        configFile,
        configImport: `@/config/${configGroup}/${slug}-fields`,
        componentPrefix: `${typeNamespace}${plan.resource.namespace}`,
        menu: {
          mode: menuMode,
          hideResource: menuMode === "parent",
          activeMenu,
          permission: options.permission || null,
          order: numberOrNull(options.order, "--order"),
        },
        parent: {
          create: Boolean(options.createParent),
          title: options.parentTitle || null,
          icon: options.parentIcon || null,
          order: numberOrNull(options.parentOrder, "--parent-order"),
          permission: options.parentPermission || null,
        },
      },
      review,
    };
  });
}

async function validateParentPlacement(root, parentRoutePath, options) {
  if (!options.targetParent) return;
  const segments = parentRoutePath.split("/").filter(Boolean);
  const parentViewDirectory = path.join(root, "src", "views", ...segments);
  if (!options.createParent) {
    if (!(await exists(parentViewDirectory))) {
      throw new Error(
        `目标父路由目录不存在: ${parentViewDirectory}。如果要新建父路由，请添加 --create-parent 和 --parent-title`,
      );
    }
    return;
  }
  const containerDirectory = path.dirname(parentViewDirectory);
  if (!(await exists(containerDirectory))) {
    throw new Error(
      `新父路由的上级目录不存在: ${containerDirectory}。请先确认 --target-parent 的上层路由`,
    );
  }
}

export async function analyzeReferenceModule(projectRoot, inputPath) {
  const viewsRoot = path.join(projectRoot, "src", "views");
  const requested = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(projectRoot, inputPath);
  const resourceRoot = await resolveResourceRoot(requested);
  assertInside(
    viewsRoot,
    resourceRoot,
    "参考页面必须位于目标项目 src/views 内",
  );

  const listPath = path.join(resourceRoot, "list", "index.vue");
  const listCode = await readRequired(
    listPath,
    "参考模块必须包含 list/index.vue",
  );
  const pages = {
    list: true,
    detail: await exists(path.join(resourceRoot, "detail", "index.vue")),
    attachment: await exists(
      path.join(resourceRoot, "attachment", "index.vue"),
    ),
  };
  const pattern = {
    topSearchTool: /\bTopSearchTool\b/.test(listCode),
    dataTable: /\bNDataTable\b/.test(listCode),
    paginatedTable: /\buse(?:Engineering|Naive)PaginatedTable\b/.test(listCode),
    engineeringForm: /\bEngineeringForm\b/.test(listCode),
    addModal: /\bNModal\b/.test(listCode),
  };
  if (!pattern.dataTable || !pattern.paginatedTable) {
    throw new Error(
      `参考页面 ${listPath} 不是当前支持的 AquaSage 分页 CRUD 模式（需要 NDataTable 和分页表格 composable）`,
    );
  }

  const relativeRoot = portable(path.relative(projectRoot, resourceRoot));
  const relativeView = portable(path.relative(viewsRoot, resourceRoot));
  const referenceRouteName = relativeView.split("/").join("_");
  const serviceImport = firstImport(listCode, "@/service/api/");
  const configImport = firstImport(listCode, "@/config/");
  const serviceGroup = serviceImport
    ? path.posix.dirname(serviceImport.slice("@/service/api/".length))
    : null;
  const configGroup = configImport
    ? path.posix.dirname(configImport.slice("@/config/".length))
    : null;
  const menu = await inferReferenceMenu(projectRoot, referenceRouteName);

  return {
    relativeRoot,
    routeName: referenceRouteName,
    pages,
    pattern,
    serviceGroup: serviceGroup === "." ? null : serviceGroup,
    configGroup: configGroup === "." ? null : configGroup,
    menu,
  };
}

async function resolveResourceRoot(requested) {
  const stat = await fs.stat(requested);
  if (stat.isFile()) {
    if (path.basename(requested) !== "index.vue") {
      throw new Error("--reference-view 文件必须是某个 list/index.vue");
    }
    const pageDirectory = path.dirname(requested);
    return ["list", "detail", "attachment"].includes(
      path.basename(pageDirectory),
    )
      ? path.dirname(pageDirectory)
      : pageDirectory;
  }
  if (!stat.isDirectory()) throw new Error(`无效参考页面: ${requested}`);
  if (
    ["list", "detail", "attachment"].includes(path.basename(requested)) &&
    (await exists(path.join(requested, "index.vue")))
  ) {
    return path.dirname(requested);
  }
  return requested;
}

async function inferReferenceMenu(projectRoot, routeName) {
  const menuPath = path.join(projectRoot, "src", "router", "menu-config.ts");
  let source;
  try {
    source = await fs.readFile(menuPath, "utf8");
  } catch {
    return { hideResource: false, activeMenu: null };
  }
  const escaped = routeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `["']${escaped}["']\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
  ).exec(source);
  if (!match) return { hideResource: false, activeMenu: null };
  const activeMenu = /activeMenu\s*:\s*["']([^"']+)["']/.exec(match[1])?.[1];
  return {
    hideResource: /hideInMenu\s*:\s*true/.test(match[1]),
    activeMenu: activeMenu || null,
  };
}

function resolveMenuMode(value, reference) {
  const mode = value || "reference";
  if (!["reference", "resource", "parent"].includes(mode)) {
    throw new Error("--menu-mode 只能是 reference、resource 或 parent");
  }
  if (mode === "reference") {
    return reference?.menu.hideResource ? "parent" : "resource";
  }
  return mode;
}

function requestImportFor(serviceFile) {
  const from = path.posix.dirname(serviceFile);
  const relative = path.posix.relative(from, "src/service/request");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function firstImport(source, prefix) {
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  return imports.find(
    (value) => value.startsWith(prefix) && !value.endsWith("/attachment"),
  );
}

function normalizeRoutePath(value) {
  const routePath = `/${String(value || "")}`
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  const segments = routePath.split("/").filter(Boolean);
  if (
    !segments.length ||
    segments.some((item) => !/^[a-z0-9-]+$/i.test(item))
  ) {
    throw new Error(`无效目标父路由: ${value}`);
  }
  return `/${segments.join("/")}`;
}

function routeNameFromPath(routePath) {
  return routePath.split("/").filter(Boolean).join("_");
}

function normalizeGroup(value, label) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.split("/").some((item) => !/^[a-z0-9-]+$/i.test(item))
  ) {
    throw new Error(
      `${label}必须由字母、数字、短横线和目录分隔符组成: ${value}`,
    );
  }
  return normalized;
}

function normalizeIdentifier(value, label) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(value))) {
    throw new Error(`${label}不是合法 TypeScript 标识符: ${value}`);
  }
  return String(value);
}

function normalizeSlug(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value))) {
    throw new Error(`资源 slug 必须是 kebab-case: ${value}`);
  }
  return String(value);
}

function numberOrNull(value, optionName) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${optionName} 必须是数字`);
  return number;
}

function toPascalCase(value) {
  return String(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join("");
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function assertInside(root, target, message) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`${message}: ${target}`);
  }
}

async function readRequired(filePath, message) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${message}: ${filePath}`);
    throw error;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function portable(value) {
  return String(value).replace(/\\/g, "/");
}
