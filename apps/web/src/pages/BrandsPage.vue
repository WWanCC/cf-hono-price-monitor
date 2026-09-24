<script setup lang="ts">
/** 品牌主数据维护。品牌仍被 Product 引用时，后端会阻止物理删除。 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { api, type Brand } from '../api'
import { confirmDanger, showError } from '../ui'

const rows = ref<Brand[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)

const form = reactive({
  name: '',
  note: '',
})

async function load() {
  loading.value = true
  try {
    rows.value = await api.brands()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.name = ''
  form.note = ''
  dialogVisible.value = true
}

function openEdit(row: Brand) {
  editingId.value = row.id
  form.name = row.name
  form.note = row.note || ''
  dialogVisible.value = true
}

async function save() {
  try {
    const payload = {
      name: form.name,
      note: form.note || null,
    }

    if (editingId.value) {
      await api.updateBrand(editingId.value, payload)
    } else {
      await api.createBrand(payload)
    }

    dialogVisible.value = false
    ElMessage.success('已保存')
    await load()
  } catch (error) {
    showError(error)
  }
}

async function toggle(row: Brand) {
  try {
    await api.updateBrand(row.id, { enabled: row.enabled })
    ElMessage.success(row.enabled ? '已启用' : '已停用')
  } catch (error) {
    // el-switch 已先修改本地值，请求失败时回滚 UI。
    row.enabled = !row.enabled
    showError(error)
  }
}

async function remove(row: Brand) {
  try {
    await confirmDanger(
      `删除品牌“${row.name}”？如果品牌下仍有商品，系统会拒绝删除。`,
    )
    await api.deleteBrand(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showError(error)
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h2>品牌管理</h2>
        <p>品牌属于主数据；有商品引用时不能删除。</p>
      </div>
      <el-button type="primary" @click="openCreate">新增品牌</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="品牌" />
      <el-table-column prop="note" label="备注" min-width="220" />
      <el-table-column label="启用" width="100">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" @change="toggle(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑品牌' : '新增品牌'"
      width="480"
    >
      <el-form label-width="70">
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>
