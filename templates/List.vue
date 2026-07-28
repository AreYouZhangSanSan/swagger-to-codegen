<template>
  <div class="list-container">
    <!-- 搜索区域 -->
    <div class="search-area">
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="名称">
          <el-input v-model="searchForm.name" placeholder="请输入名称" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">搜索</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 表格区域 -->
    <el-table :data="tableData" border style="width: 100%">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="createTime" label="创建时间" />
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <el-button size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <el-pagination
      v-model:current-page="pagination.page"
      v-model:page-size="pagination.pageSize"
      :total="pagination.total"
      layout="total, prev, pager, next"
      @current-change="loadData"
    />

    <!-- 表单弹窗 -->
    <FormDialog v-model="dialogVisible" :id="currentId" @success="loadData" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import FormDialog from './FormDialog.vue'

const searchForm = ref({})
const tableData = ref([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const dialogVisible = ref(false)
const currentId = ref(null)

function handleSearch() {
  pagination.value.page = 1
  loadData()
}

function handleReset() {
  searchForm.value = {}
  handleSearch()
}

function handleEdit(row) {
  currentId.value = row.id
  dialogVisible.value = true
}

async function handleDelete(row) {
  // TODO: 调用删除API
  await loadData()
}

async function loadData() {
  // TODO: 调用列表API
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.list-container {
  padding: 20px;
}
.search-area {
  margin-bottom: 20px;
}
</style>
