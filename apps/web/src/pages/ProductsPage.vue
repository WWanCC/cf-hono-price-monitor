<script setup lang="ts">
/**
 * 逻辑商品维护。
 * 一个 Product 是业务聚合根：向上连接 Brand/Supplier，向下连接 Listing/SKU/Monitor。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { api, type Brand, type Product, type Supplier } from '../api'
import { confirmDanger, showError } from '../ui'

const rows = ref<Product[]>([])
const brands = ref<Brand[]>([])
const suppliers = ref<Supplier[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)

const form = reactive<{
  name: string
  brandId: number | null
  supplierId: number | null
  supplierProductUrl: string
  note: string
}>({
  name: '',
  brandId: null,
  supplierId: null,
  supplierProductUrl: '',
  note: '',
})

async function load() {
  loading.value = true
  try {
    const [productRows, brandRows, supplierRows] = await Promise.all([
      api.products(),
      api.brands(),
      api.suppliers(),
    ])

    rows.value = productRows
    brands.value = brandRows
    suppliers.value = supplierRows
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
    brandId: null,
    supplierId: null,
    supplierProductUrl: '',
    note: '',
  })
  dialogVisible.value = true
}

function openEdit(row: Product) {
  editingId.value = row.id
  Object.assign(form, {
    name: row.name,
    brandId: row.brandId,
    supplierId: row.supplierId,
    supplierProductUrl: row.supplierProductUrl || '',
    note: row.note || '',
  })
  dialogVisible.value = true
}

async function save() {
  if (!form.brandId) {
    ElMessage.warning('请选择品牌')
    return
  }

  const payload = {
    brandId: form.brandId,
    supplierId: form.supplierId,
    name: form.name,
    supplierProductUrl: form.supplierProductUrl || null,
    note: form.note || null,
  }

  try {
    if (editingId.value) {
      await api.updateProduct(editingId.value, payload)
    } else {
      await api.createProduct(payload)
    }

    dialogVisible.value = false
    ElMessage.success('已保存')
    await load()
  } catch (error) {
    showError(error)
  }
}

async function toggle(row: Product) {
  try {
    await api.updateProduct(row.id, { enabled: row.enabled })
  } catch (error) {
    row.enabled = !row.enabled
    showError(error)
  }
}

async function remove(row: Product) {
  try {
    await confirmDanger(
      `删除商品“${row.name}”会级联删除其 Listing、SKU 和 Monitor。此操作不可恢复。`,
      '危险操作',
    )
    await api.deleteProduct(row.id)
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
        <h2>商品管理</h2>
        <p>逻辑商品连接品牌、上游、官方商品、自店商品与 SKU 监控。</p>
      </div>
      <el-button type="primary" @click="openCreate">新增商品</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column prop="name" label="商品" min-width="180" />
      <el-table-column prop="brandName" label="品牌" />
      <el-table-column prop="supplierName" label="上游" />
      <el-table-column label="上游链接" width="100">
        <template #default="{ row }">
          <a
            v-if="row.supplierProductUrl"
            :href="row.supplierProductUrl"
            target="_blank"
          >
            打开
          </a>
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
      :title="editingId ? '编辑商品' : '新增商品'"
      width="560"
    >
      <el-form label-width="90">
        <el-form-item label="商品名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="品牌">
          <el-select v-model="form.brandId" filterable style="width: 100%">
            <el-option
              v-for="brand in brands"
              :key="brand.id"
              :label="brand.name"
              :value="brand.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="上游">
          <el-select
            v-model="form.supplierId"
            filterable
            clearable
            style="width: 100%"
          >
            <el-option
              v-for="supplier in suppliers"
              :key="supplier.id"
              :label="supplier.name"
              :value="supplier.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="上游链接">
          <el-input v-model="form.supplierProductUrl" />
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
