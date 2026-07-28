<script setup lang="tsx">
import { reactive, ref } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NDatePicker,
  NForm,
  NFormItemGi,
  NGrid,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpace,
  NTag,
  useMessage,
} from "naive-ui";
import type { FlatResponseData } from "@sa/axios";
import {
  fetchList_policy_policy_page,
  undefined,
  fetchCreate_policy_api,
  fetchUpdate_policy_api,
  fetchDelete_policy_api,
} from "@/api/modules/policy";
import {
  useNaivePaginatedTable,
  useTableMaxHeight,
} from "@/hooks/common/table";
import TopSearchTool from "@/components/advanced/top-search-tool.vue";
import TableHeaderOperation from "@/components/advanced/table-header-operation.vue";
import { $t } from "@/locales";
import { useRouter } from "vue-router";

defineOptions({
  name: "PolicyList",
});

const message = useMessage();
const router = useRouter();

const checkedRowKeys = ref<Array<string | number>>([]);

const searchParams = reactive<{
  current: number;
  size: number;
  order: string;
  order_by: string;
  title?: string;
  category?: string;
  publish_department?: string;
}>({
  current: 1,
  size: 15,
  order: "id",
  order_by: "asc",
  title: undefined,
  category: undefined,
  publish_department: undefined,
});

const addModalVisible = ref(false);
const addForm = reactive({
  title: "",
  url: "",
  content: "",
  publish_time: null as number | null,
  publish_department: "",
  source: "",
  category: "",
  file_info: "",
});

const detailModalVisible = ref(false);
const detailData = ref<any>({});

const categoryOptions = [
  { label: "政策法规", value: "政策法规" },
  { label: "行业标准", value: "行业标准" },
  { label: "内部制度", value: "内部制度" },
  { label: "其他", value: "其他" },
];

type PolicyRow = {
  id: number;
  title: string;
  url: string;
  content: string;
  publish_time: string | number | null;
  publish_department: string;
  source: string;
  category: string;
  file_info: string;
};

type PolicyListResponse = FlatResponseData<
  App.Service.Response<App.Service.PagedData<PolicyRow>>,
  App.Service.Response<any>
>;

const tableData = useNaivePaginatedTable<PolicyListResponse, PolicyRow>({
  api: async () => {
    return fetchList_policy_policy_page(searchParams as any);
  },
  transform: (response) => {
    const { data: payload, error } = response;
    if (!error && payload?.data) {
      const { data: records, current, size, total } = payload.data;
      return {
        data: records,
        pageNum: current,
        pageSize: size,
        total,
      };
    }
    return {
      data: [],
      pageNum: 1,
      pageSize: 15,
      total: 0,
    };
  },
  onPaginationParamsChange: ({ page, pageSize }) => {
    searchParams.current = page ?? 1;
    searchParams.size = pageSize ?? 15;
  },
  paginationProps: {
    pageSize: searchParams.size ?? 15,
    pageSizes: [15, 20, 30, 50],
  },
  showTotal: true,
  columns: () => [
    {
      type: "selection",
      align: "center",
      width: 48,
    },
    {
      key: "index",
      title: $t("common.index"),
      align: "center",
      width: 64,
      render: (_, index) =>
        ((searchParams.current ?? 1) - 1) * (searchParams.size ?? 15) +
        index +
        1,
    },
    {
      key: "title",
      title: "政策标题",
      align: "center",
      width: 220,
    },
    {
      key: "category",
      title: "分类",
      align: "center",
      width: 120,
      render: (row) =>
        row.category ? (
          <NTag type="info" size="small" bordered={false}>
            {row.category}
          </NTag>
        ) : null,
    },
    {
      key: "publish_department",
      title: "发布部门",
      align: "center",
      width: 180,
    },
    {
      key: "publish_time",
      title: "发布时间",
      align: "center",
      width: 120,
      render: (row) => (row.publish_time ? formatDate(row.publish_time) : ""),
    },
    {
      key: "source",
      title: "来源",
      align: "center",
      width: 160,
    },
    {
      key: "url",
      title: "链接",
      align: "center",
      width: 120,
      render: (row) =>
        row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            style="color: #1890ff;"
          >
            打开链接
          </a>
        ) : null,
    },
    {
      key: "operate",
      title: $t("common.operate"),
      align: "center",
      width: 240,
      render: (row) => (
        <div class="flex-center gap-8px">
          <NButton
            type="primary"
            ghost
            size="small"
            onClick={() => handleView(row)}
          >
            查看
          </NButton>
          <NButton
            type="info"
            ghost
            size="small"
            onClick={() => handleEdit(row)}
          >
            编辑
          </NButton>
          <NPopconfirm onPositiveClick={() => handleDelete(row.id)}>
            {{
              default: () => $t("common.confirmDelete"),
              trigger: () => (
                <NButton type="error" ghost size="small">
                  {$t("common.delete")}
                </NButton>
              ),
            }}
          </NPopconfirm>
        </div>
      ),
    },
  ],
});

const {
  columns,
  columnChecks,
  data,
  loading,
  pagination,
  getData,
  getDataByPage,
} = tableData;
const tableMaxHeight = useTableMaxHeight();

function formatDate(ts: any): string {
  if (!ts) return "";
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function handleReset() {
  Object.assign(searchParams, {
    current: 1,
    size: 15,
    order: "id",
    order_by: "asc",
    title: undefined,
    category: undefined,
    publish_department: undefined,
  });
  getDataByPage(1);
}

function handleAdd() {
  Object.assign(addForm, {
    title: "",
    url: "",
    content: "",
    publish_time: null,
    publish_department: "",
    source: "",
    category: "",
    file_info: "",
  });
  addModalVisible.value = true;
}

async function handleAddSubmit() {
  if (!addForm.title) {
    message.error("请输入政策标题");
    return;
  }
  const { error } = await fetchCreate_policy_api({
    ...addForm,
    publish_time: formatDate(addForm.publish_time) || null,
  } as any);
  if (!error) {
    message.success("新增成功");
    addModalVisible.value = false;
    await getData();
  } else {
    message.error("新增失败");
  }
}

function handleView(row: PolicyRow) {
  detailData.value = { ...row };
  detailModalVisible.value = true;
}

function handleEdit(row: PolicyRow) {
  router.push({
    path: "/policy/detail",
    query: { ...row, id: row.id },
  });
}

async function handleDelete(id: number) {
  const { error } = await fetchDelete_policy_api([id]);
  if (!error) {
    message.success("删除成功");
    await getData();
  }
}

async function handleBatchDelete() {
  const ids = checkedRowKeys.value.map((id) => Number(id));
  const { error } = await fetchDelete_policy_api(ids);
  if (!error) {
    message.success("批量删除成功");
    checkedRowKeys.value = [];
    await getData();
  }
}
</script>

<template>
  <div class="h-full flex-col-stretch gap-16px overflow-hidden">
    <NCard size="small" :bordered="false">
      <NGrid :cols="3" :x-gap="16" responsive="screen">
        <NFormItemGi label="政策标题" :label-width="80">
          <NInput
            v-model:value="searchParams.title"
            placeholder="请输入标题"
            clearable
          />
        </NFormItemGi>
        <NFormItemGi label="分类" :label-width="80">
          <NSelect
            v-model:value="searchParams.category"
            :options="categoryOptions"
            placeholder="请选择分类"
            clearable
          />
        </NFormItemGi>
        <NFormItemGi label="发布部门" :label-width="80">
          <NInput
            v-model:value="searchParams.publish_department"
            placeholder="请输入部门"
            clearable
          />
        </NFormItemGi>
      </NGrid>
      <div class="flex justify-end mt-12px">
        <NSpace>
          <NButton @click="handleReset">{{ $t("common.reset") }}</NButton>
          <NButton type="primary" @click="getDataByPage(1)">{{
            $t("common.search")
          }}</NButton>
        </NSpace>
      </div>
    </NCard>

    <NCard
      title="政策列表"
      :bordered="false"
      size="small"
      class="flex-1-hidden card-wrapper"
    >
      <template #header-extra>
        <TableHeaderOperation
          v-model:columns="columnChecks"
          :disabled-delete="checkedRowKeys.length === 0"
          :loading="loading"
          @add="handleAdd"
          @delete="handleBatchDelete"
          @refresh="getData"
        />
      </template>
      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
        :columns="columns"
        :data="data"
        size="small"
        :max-height="tableMaxHeight"
        :scroll-x="1200"
        :loading="loading"
        remote
        :row-key="(row: PolicyRow) => row.id"
        :pagination="pagination"
      />
    </NCard>

    <NModal
      v-model:show="addModalVisible"
      style="width: 70%"
      preset="card"
      title="新增政策"
      :mask-closable="false"
    >
      <NForm label-placement="left" :label-width="100">
        <NGrid :cols="2" :x-gap="16">
          <NFormItemGi label="政策标题" required>
            <NInput v-model:value="addForm.title" placeholder="请输入标题" />
          </NFormItemGi>
          <NFormItemGi label="URL链接">
            <NInput v-model:value="addForm.url" placeholder="请输入链接" />
          </NFormItemGi>
          <NFormItemGi label="分类">
            <NSelect
              v-model:value="addForm.category"
              :options="categoryOptions"
              placeholder="请选择分类"
              clearable
            />
          </NFormItemGi>
          <NFormItemGi label="发布部门">
            <NInput
              v-model:value="addForm.publish_department"
              placeholder="请输入发布部门"
            />
          </NFormItemGi>
          <NFormItemGi label="来源">
            <NInput v-model:value="addForm.source" placeholder="请输入来源" />
          </NFormItemGi>
          <NFormItemGi label="发布时间">
            <NDatePicker
              v-model:value="addForm.publish_time"
              type="date"
              clearable
              style="width: 100%"
            />
          </NFormItemGi>
        </NGrid>
        <NGrid :cols="1" class="mt-8px">
          <NFormItemGi label="内容">
            <NInput
              v-model:value="addForm.content"
              type="textarea"
              placeholder="请输入内容"
              :autosize="{ minRows: 3, maxRows: 6 }"
            />
          </NFormItemGi>
          <NFormItemGi label="附件信息">
            <NInput v-model:value="addForm.file_info" placeholder="附件信息" />
          </NFormItemGi>
        </NGrid>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="addModalVisible = false">{{
            $t("common.cancel")
          }}</NButton>
          <NButton type="primary" @click="handleAddSubmit">{{
            $t("common.confirm")
          }}</NButton>
        </NSpace>
      </template>
    </NModal>

    <NModal
      v-model:show="detailModalVisible"
      preset="card"
      title="政策详情"
      style="width: 60%"
      :mask-closable="true"
    >
      <div v-if="detailData" class="detail-panel">
        <NGrid :cols="2" :x-gap="16" class="mb-16px">
          <div><strong>标题：</strong>{{ detailData.title }}</div>
          <div><strong>分类：</strong>{{ detailData.category }}</div>
          <div>
            <strong>发布部门：</strong>{{ detailData.publish_department }}
          </div>
          <div><strong>来源：</strong>{{ detailData.source }}</div>
          <div>
            <strong>发布时间：</strong>{{ formatDate(detailData.publish_time) }}
          </div>
          <div>
            <strong>链接：</strong>
            <a v-if="detailData.url" :href="detailData.url" target="_blank"
              >打开链接</a
            >
          </div>
        </NGrid>
        <div v-if="detailData.content" class="mb-8px">
          <strong>内容：</strong>
          <p class="pre-wrap">{{ detailData.content }}</p>
        </div>
        <div v-if="detailData.file_info">
          <strong>附件信息：</strong>{{ detailData.file_info }}
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.detail-panel {
  word-break: break-all;
}
.pre-wrap {
  white-space: pre-wrap;
}
</style>
