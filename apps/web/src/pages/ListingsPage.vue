<script setup lang="ts">
/**
 * Listing / SKU 管理页面。
 * Listing 通过喵喵折解析产生，SKU 由导入结果维护，不在页面上手工创建。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { api, type Listing, type ListingSku, type Product } from '../api'
import { confirmDanger, showError } from '../ui'

const products = ref<Product[]>([])
const productId = ref<number | null>(null)
const rows = ref<Listing[]>([])
const loading = ref(false)

const importDialogVisible = ref(false)
const skuDialogVisible = ref(false)
const skuRows = ref<ListingSku[]>([])
const skuTitle = ref('')

const form = reactive<{
  role: 'official' | 'own'
  content: string
}>({
  role: 'official',
  content: '',
})

async function loadProducts() {
  try {
    products.value = await api.products()

    if (!productId.value && products.value.length > 0) {
      productId.value = products.value[0].id
    }

    await load()
  } catch (error) {
    showError(error)
  }
}

async function load() {
  if (!productId.value) {
    rows.value = []
    return
  }

  loading.value = true
  try {
    rows.value = await api.listings(productId.value)
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function doImport() {
  if (!productId.value) return

  try {
    const result = await api.importListing({
      productId: productId.value,
      role: form.role,
      content: form.content,
    })

    importDialogVisible.value = false
    form.content = ''
    ElMessage.success(`导入成功，共 ${result.skuCount} 个 SKU`)
    await load()
  } catch (error) {
    showError(error)
  }
}

async function toggle(row: Listing) {
  try {
    await api.updateListing(row.id, { enabled: row.enabled })
  } catch (error) {
    row.enabled = !row.enabled
    showError(error)
  }
}

async function remove(row: Listing) {
  try {
    await confirmDanger(
      `删除“${row.title || row.externalItemId}”会级联删除其 SKU，并删除引用这些 SKU 的 Monitor。`,
    )
    await api.deleteListing(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showError(error)
  }
}

async function showSkus(row: Listing) {
  try {
    skuRows.value = await api.skus(row.id)
    skuTitle.value = `${row.role === 'official' ? '官方' : '自店'} · ${row.title || row.externalItemId}`
    skuDialogVisible.value = true
  } catch (error) {
    showError(error)
  }
}

async function toggleSku(row: ListingSku) {
  try {
    await api.updateSku(row.id, { enabled: row.enabled })
  } catch (error) {
    row.enabled = !row.enabled
    showError(error)
  }
}

onMounted(loadProducts)
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h2>商品链接 / SKU</h2>
        <p>导入官方旗舰店或自店链接；重复导入会刷新数据，并自动停用已消失的旧 SKU。</p>
      </div>
      <el-button
        type="primary"
        :disabled="!productId"
        @click="importDialogVisible = true"
      >
        导入链接
      </el-button>
    </div>

    <div class="toolbar">
      <span>逻辑商品：</span>
      <el-select
        v-model="productId"
        filterable
        style="width: 320px"
        @change="load"
      >
        <el-option
          v-for="product in products"
          :key="product.id"
          :label="product.name"
          :value="product.id"
        />
      </el-select>
    </div>

    <el-table v-loading="loading" :data="rows" stripe>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag :type="row.role === 'official' ? 'success' : 'primary'">
            {{ row.role === 'official' ? '官方' : '自店' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="220" />
      <el-table-column prop="shopName" label="店铺" />
      <el-table-column prop="platform" label="平台" width="90" />
      <el-table-column label="链接" width="80">
        <template #default="{ row }">
          <a :href="row.url" target="_blank">打开</a>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="90">
        <template #default="{ row }">
          <el-switch v-model="row.enabled" @change="toggle(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <el-button link type="primary" @click="showSkus(row)">SKU</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="importDialogVisible"
      title="导入淘宝 / 天猫商品"
      width="620"
    >
      <el-form label-width="90">
        <el-form-item label="类型">
          <el-radio-group v-model="form.role">
            <el-radio-button value="official">官方参考</el-radio-button>
            <el-radio-button value="own">自店商品</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="商品链接">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="5"
            placeholder="粘贴淘宝/天猫链接或喵喵折可解析的剪贴板内容"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="doImport">解析并导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="skuDialogVisible" :title="skuTitle" width="760">
      <el-table :data="skuRows">
        <el-table-column prop="name" label="SKU" min-width="260" />
        <el-table-column prop="externalSkuId" label="skuId" min-width="180" />
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" @change="toggleSku(row)" />
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </section>
</template>
