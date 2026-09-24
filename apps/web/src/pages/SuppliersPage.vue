<script setup lang="ts">
/** 上游厂家维护。删除 Supplier 后，Product.supplierId 按外键策略自动置空。 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { api, type Supplier } from '../api'
import { confirmDanger, showError } from '../ui'

const rows = ref<Supplier[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)

const form = reactive({
  name: '',
  shopName: '',
  shopUrl: '',
  note: '',
})

async function load() {
  loading.value = true
  try {
    rows.value = await api.suppliers()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, {
    name: '',
    shopName: '',
    shopUrl: '',
    note: '',
  })
  dialogVisible.value = true
}

function openEdit(row: Supplier) {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    shopName: row.shopName || '',
    shopUrl: row.shopUrl || '',
    note: row.note || '',
  })
  dialogVisible.value = true
}

async function save() {
  const payload = {
    name: form.name,
    shopName: form.shopName || null,
    shopUrl: form.shopUrl || null,
    note: form.note || null,
  }

  try {
    if (editingId.value) {
      await api.updateSupplier(editingId.value, payload)
    } else {
      await api.createSupplier(payload)
    }

    dialogVisible.value = false
    ElMessage.success('已保存')
    await load()
  } catch (error) {
    showError(error)
  }
}

async function toggle(row: Supplier) {
  try {
    await api.updateSupplier(row.id, { enabled: row.enabled })
  } catch (error) {
    row.enabled = !row.enabled
    showError(error)
  }
}

async function remove(row: Supplier) {
  try {
    await confirmDanger(
      `删除上游“${row.name}”？已关联商品会保留，但上游关联会自动置空。`,
    )
    await api.deleteSupplier(row.id)
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
        <h2>上游厂家</h2>
        <p>删除上游不会删除商品，商品的 supplierId 会自动置空。</p>
      </div>
      <el-button type="primary" @click="openCreate">新增上游</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="name" label="厂家" />
      <el-table-column prop="shopName" label="店铺名" />
      <el-table-column label="店铺链接" min-width="220">
        <template #default="{ row }">
          <a v-if="row.shopUrl" :href="row.shopUrl" target="_blank">打开</a>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="90">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" @change="toggle(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑上游' : '新增上游'"
      width="540"
    >
      <el-form label-width="80">
        <el-form-item label="厂家">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="店铺名">
          <el-input v-model="form.shopName" />
        </el-form-item>
        <el-form-item label="店铺链接">
          <el-input v-model="form.shopUrl" />
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
