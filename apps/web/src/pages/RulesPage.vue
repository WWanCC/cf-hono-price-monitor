<script setup lang="ts">
/** 常用价格规则模板。模板只在创建 Monitor 时复制表达式，不会联动修改已有 Monitor。 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import { api, type RulePreset } from '../api'
import { confirmDanger, showError } from '../ui'

const rows = ref<RulePreset[]>([])
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)

const form = reactive({
  name: '',
  expression: '',
})

async function load() {
  try {
    rows.value = await api.rulePresets()
  } catch (error) {
    showError(error)
  }
}

function openCreate() {
  editingId.value = null
  form.name = ''
  form.expression = 'own >= official'
  dialogVisible.value = true
}

function openEdit(row: RulePreset) {
  editingId.value = row.id
  form.name = row.name
  form.expression = row.expression
  dialogVisible.value = true
}

async function save() {
  try {
    if (editingId.value) {
      await api.updateRulePreset(editingId.value, form)
    } else {
      await api.createRulePreset(form)
    }

    dialogVisible.value = false
    ElMessage.success('已保存')
    await load()
  } catch (error) {
    showError(error)
  }
}

async function remove(row: RulePreset) {
  try {
    await confirmDanger(`删除规则“${row.name}”？`)
    await api.deleteRulePreset(row.id)
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
        <h2>常用规则</h2>
        <p>规则模板只用于快速填充 Monitor，不会反向修改已有 Monitor。</p>
      </div>
      <el-button type="primary" @click="openCreate">新增规则</el-button>
    </div>

    <el-table :data="rows" stripe>
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="expression" label="表达式" min-width="300" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑规则' : '新增规则'"
      width="520"
    >
      <el-form label-width="80">
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="表达式">
          <el-input v-model="form.expression" />
          <div class="hint">
            支持 + - * / &gt; &gt;= &lt; &lt;= == != &amp;&amp; || 与括号。
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>
