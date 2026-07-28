<script setup lang="tsx">
import { ref, reactive, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  NButton,
  NCard,
  NDatePicker,
  NForm,
  NFormItemGi,
  NGrid,
  NInput,
  NSelect,
  NSpace,
  useMessage,
} from "naive-ui";
import {
  fetchList_policy_policy_page,
  undefined,
  fetchCreate_policy_api,
  fetchUpdate_policy_api,
  fetchDelete_policy_api,
} from "@/api/modules/policy";

const route = useRoute();
const router = useRouter();
const message = useMessage();

const isEdit = ref(false);
const formData = reactive({
  id: null as number | null,
  title: "",
  url: "",
  content: "",
  publish_time: null as number | null,
  publish_department: "",
  source: "",
  category: "",
  file_info: "",
});

const categoryOptions = [
  { label: "政策法规", value: "政策法规" },
  { label: "行业标准", value: "行业标准" },
  { label: "内部制度", value: "内部制度" },
  { label: "其他", value: "其他" },
];

onMounted(() => {
  const query = route.query;
  if (query.id) {
    isEdit.value = true;
    formData.id = Number(query.id);
    formData.title = (query.title as string) || "";
    formData.url = (query.url as string) || "";
    formData.content = (query.content as string) || "";
    if (query.publish_time) {
      formData.publish_time = Number(query.publish_time) || null;
    }
    formData.publish_department = (query.publish_department as string) || "";
    formData.source = (query.source as string) || "";
    formData.category = (query.category as string) || "";
    formData.file_info = (query.file_info as string) || "";
  } else {
    message.error("缺少参数，无法编辑");
    router.back();
  }
});

async function handleSubmit() {
  if (!formData.title) {
    message.error("请输入政策标题");
    return;
  }
  const { error } = await fetchUpdate_policy_api({
    id: formData.id,
    title: formData.title,
    url: formData.url,
    content: formData.content,
    publish_time: formatDate(formData.publish_time) || null,
    publish_department: formData.publish_department,
    source: formData.source,
    category: formData.category,
    file_info: formData.file_info,
  } as any);
  if (!error) {
    message.success("更新成功");
    router.back();
  } else {
    message.error("更新失败");
  }
}

function formatDate(ts: number | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function handleBack() {
  router.back();
}
</script>

<template>
  <div class="p-16px">
    <NCard title="编辑政策" :bordered="false" size="small">
      <template #header-extra>
        <NButton @click="handleBack">返回</NButton>
      </template>
      <NForm label-placement="left" :label-width="100">
        <NGrid :cols="2" :x-gap="16">
          <NFormItemGi label="政策标题" required>
            <NInput v-model:value="formData.title" placeholder="请输入标题" />
          </NFormItemGi>
          <NFormItemGi label="URL链接">
            <NInput v-model:value="formData.url" placeholder="请输入链接" />
          </NFormItemGi>
          <NFormItemGi label="分类">
            <NSelect
              v-model:value="formData.category"
              :options="categoryOptions"
              placeholder="请选择分类"
              clearable
            />
          </NFormItemGi>
          <NFormItemGi label="发布部门">
            <NInput
              v-model:value="formData.publish_department"
              placeholder="请输入发布部门"
            />
          </NFormItemGi>
          <NFormItemGi label="来源">
            <NInput v-model:value="formData.source" placeholder="请输入来源" />
          </NFormItemGi>
          <NFormItemGi label="发布时间">
            <NDatePicker
              v-model:value="formData.publish_time"
              type="date"
              clearable
              style="width: 100%"
            />
          </NFormItemGi>
        </NGrid>
        <NGrid :cols="1" class="mt-8px">
          <NFormItemGi label="内容">
            <NInput
              v-model:value="formData.content"
              type="textarea"
              placeholder="请输入内容"
              :autosize="{ minRows: 3, maxRows: 6 }"
            />
          </NFormItemGi>
          <NFormItemGi label="附件信息">
            <NInput v-model:value="formData.file_info" placeholder="附件信息" />
          </NFormItemGi>
        </NGrid>
      </NForm>
      <div class="flex justify-end mt-16px">
        <NSpace>
          <NButton @click="handleBack">取消</NButton>
          <NButton type="primary" @click="handleSubmit">保存</NButton>
        </NSpace>
      </div>
    </NCard>
  </div>
</template>
