<script setup lang="ts">
/**
 * 价格监控页面。
 *
 * v1.5.1 把实际操作流程拆成两个阶段：
 *
 * 阶段 1：建立 SKU 映射
 *   - 选择逻辑商品；
 *   - 多选官方 SKU 和自店 SKU；
 *   - 选择“一一配对”或“全部组合”；
 *   - 只保存映射，不要求此时决定价格规则。
 *
 * 阶段 2：统一应用规则
 *   - 回到当前列表；
 *   - 使用表格第一列复选框勾选已经整理好的映射；
 *   - 从顶部“常用规则”下拉框选择规则；
 *   - 一次应用到所有已选行，并可选择是否同时启用。
 *
 * 这种交互更符合运营习惯：先把 SKU 对应关系整理完整，再统一配置控价规则。
 *
 * v1.6.1 增加后台状态轮询：Cron + Queue 完成检测后，本页面会自动同步最新状态和检测时间。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

import {
  api,
  type ListingSku,
  type Monitor,
  type MonitorPairInput,
  type Product,
  type RulePreset,
} from '../api'
import {
  buildMonitorPairs,
  type PairingMode,
  validateMonitorPairSelection,
} from '../monitor-pairing'
import { confirmDanger, showError } from '../ui'

const MAX_BATCH_MONITORS = 100

type SkuOption = ListingSku & {
  listingTitle: string
  shopName: string | null
}

type PairPreviewRow = MonitorPairInput & {
  referenceName: string
  targetName: string
}

const rows = ref<Monitor[]>([])
const products = ref<Product[]>([])
const presets = ref<RulePreset[]>([])
const loading = ref(false)

// -------------------- 表格批量规则 --------------------

/** 当前表格勾选的 Monitor。Element Plus 会通过 selection-change 整体回传。 */
const selectedRows = ref<Monitor[]>([])

/** 用户在列表顶部选择的“常用规则”模板。 */
const bulkPresetId = ref<number | null>(null)

/**
 * 默认在应用规则后直接启用。
 * 新建 SKU 映射默认是 disabled，勾选规则后直接启用可以少一步逐行开开关。
 */
const enableAfterApply = ref(true)
const applyingRule = ref(false)

const selectedPreset = computed(() =>
  presets.value.find((preset) => preset.id === bulkPresetId.value) ?? null,
)

const selectedCount = computed(() => selectedRows.value.length)

const canApplyRule = computed(
  () =>
    selectedCount.value > 0 &&
    selectedCount.value <= MAX_BATCH_MONITORS &&
    Boolean(selectedPreset.value),
)

function handleSelectionChange(selection: Monitor[]) {
  selectedRows.value = selection
}

/**
 * 把一条常用规则统一写入所有已勾选 Monitor。
 * 后端会再次验证规则表达式，并分批执行 D1 UPDATE。
 */
async function applyRuleToSelection() {
  if (selectedRows.value.length === 0) {
    ElMessage.warning('请先勾选需要应用规则的 SKU 映射')
    return
  }

  if (selectedRows.value.length > MAX_BATCH_MONITORS) {
    ElMessage.warning(`单次最多应用 ${MAX_BATCH_MONITORS} 条规则`)
    return
  }

  if (!selectedPreset.value) {
    ElMessage.warning('请先选择一条常用规则')
    return
  }

  applyingRule.value = true

  try {
    const result = await api.applyMonitorRuleBatch({
      monitorIds: selectedRows.value.map((row) => row.id),
      ruleExpression: selectedPreset.value.expression,
      enableAfterApply: enableAfterApply.value,
    })

    const enabledText = result.enabledAfterApply ? '并已启用' : ''
    ElMessage.success(
      `已为 ${result.updated} 条 SKU 映射应用“${selectedPreset.value.name}”${enabledText}`,
    )

    await load()
  } catch (error) {
    showError(error)
  } finally {
    applyingRule.value = false
  }
}

// -------------------- 新建 SKU 映射 --------------------

const createDialogVisible = ref(false)
const createSaving = ref(false)

const officialSkus = ref<SkuOption[]>([])
const ownSkus = ref<SkuOption[]>([])

/**
 * 新建表单只保存“如何建立 SKU 对应关系”，不再保存价格规则。
 * 规则统一在列表勾选后应用，避免在映射尚未整理完整时频繁切换规则。
 */
const createForm = reactive<{
  productId: number | null
  referenceSkuIds: number[]
  targetSkuIds: number[]
  pairingMode: PairingMode
}>({
  productId: null,
  referenceSkuIds: [],
  targetSkuIds: [],
  pairingMode: 'zip',
})

const activeProducts = computed(() =>
  products.value.filter((product) => product.enabled),
)

const officialSkuMap = computed(
  () => new Map(officialSkus.value.map((sku) => [sku.id, sku])),
)

const ownSkuMap = computed(
  () => new Map(ownSkus.value.map((sku) => [sku.id, sku])),
)

/** 根据用户选择实时生成最终 SKU 配对。 */
const generatedPairs = computed<MonitorPairInput[]>(() =>
  buildMonitorPairs(
    createForm.referenceSkuIds,
    createForm.targetSkuIds,
    createForm.pairingMode,
  ),
)

/** 把配对 ID 转成可读名称；预览只显示前 20 条。 */
const pairPreview = computed<PairPreviewRow[]>(() =>
  generatedPairs.value.slice(0, 20).map((pair) => ({
    ...pair,
    referenceName:
      officialSkuMap.value.get(pair.referenceSkuId)?.name ??
      `SKU #${pair.referenceSkuId}`,
    targetName:
      ownSkuMap.value.get(pair.targetSkuId)?.name ??
      `SKU #${pair.targetSkuId}`,
  })),
)

/** 提交前先在前端给出数量/配对错误，后端仍会做同样的业务校验。 */
const pairValidationMessage = computed(() =>
  validateMonitorPairSelection(
    createForm.referenceSkuIds.length,
    createForm.targetSkuIds.length,
    createForm.pairingMode,
    generatedPairs.value.length,
    MAX_BATCH_MONITORS,
  ),
)

const canCreateMapping = computed(
  () => !pairValidationMessage.value && generatedPairs.value.length > 0,
)

// -------------------- 单条编辑 --------------------

const editDialogVisible = ref(false)
const editingMonitor = ref<Monitor | null>(null)
const editRule = ref('')

// -------------------- 数据加载 --------------------

async function load() {
  loading.value = true

  try {
    const [monitorRows, productRows, presetRows] = await Promise.all([
      api.monitors(),
      api.products(),
      api.rulePresets(),
    ])

    rows.value = monitorRows
    products.value = productRows
    presets.value = presetRows

    // 刷新后旧对象引用已经失效，清空勾选状态避免误操作。
    selectedRows.value = []
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

/**
 * 切换逻辑商品后重新加载其官方/自店 Listing 下的启用 SKU。
 * 只有 Product + Listing + SKU 都启用的规格才允许建立新映射。
 */
async function loadSkuOptions() {
  officialSkus.value = []
  ownSkus.value = []
  createForm.referenceSkuIds = []
  createForm.targetSkuIds = []

  if (!createForm.productId) return

  try {
    const listings = await api.listings(createForm.productId)
    const enabledListings = listings.filter((listing) => listing.enabled)

    const listingWithSkus = await Promise.all(
      enabledListings.map(async (listing) => ({
        listing,
        skus: (await api.skus(listing.id)).filter((sku) => sku.enabled),
      })),
    )

    for (const { listing, skus } of listingWithSkus) {
      const options = skus.map<SkuOption>((sku) => ({
        ...sku,
        listingTitle: listing.title || listing.externalItemId,
        shopName: listing.shopName,
      }))

      if (listing.role === 'official') {
        officialSkus.value.push(...options)
      } else {
        ownSkus.value.push(...options)
      }
    }
  } catch (error) {
    showError(error)
  }
}

function openCreate() {
  Object.assign(createForm, {
    productId: activeProducts.value[0]?.id ?? null,
    referenceSkuIds: [],
    targetSkuIds: [],
    pairingMode: 'zip' as PairingMode,
  })

  createDialogVisible.value = true
  void loadSkuOptions()
}

function selectAllOfficial() {
  createForm.referenceSkuIds = officialSkus.value.map((sku) => sku.id)
}

function selectAllOwn() {
  createForm.targetSkuIds = ownSkus.value.map((sku) => sku.id)
}

/**
 * 保存 SKU 映射，但不应用规则。
 * 后端会把新记录保存为 ruleExpression=''、enabled=false，确保不会提前进入定时检测。
 */
async function saveMappings() {
  if (pairValidationMessage.value) {
    ElMessage.warning(pairValidationMessage.value)
    return
  }

  createSaving.value = true

  try {
    const result = await api.createMonitorMappingsBatch({
      pairs: generatedPairs.value,
    })

    createDialogVisible.value = false

    if (result.created > 0) {
      const skipped =
        result.skippedExisting + result.skippedDuplicateInRequest

      ElMessage.success(
        skipped > 0
          ? `新增 ${result.created} 条 SKU 映射，跳过 ${skipped} 条重复映射；请在列表勾选后统一应用规则`
          : `已新增 ${result.created} 条 SKU 映射；请在列表勾选后统一应用规则`,
      )
    } else {
      ElMessage.warning('所选 SKU 配对都已经存在，没有创建新映射')
    }

    await load()
  } catch (error) {
    showError(error)
  } finally {
    createSaving.value = false
  }
}

// -------------------- 单条操作 --------------------

async function toggle(row: Monitor) {
  // 未配置规则时，UI 本身会禁用 switch；这里仍保留正常异常回滚逻辑。
  try {
    await api.updateMonitor(row.id, { enabled: row.enabled })
  } catch (error) {
    row.enabled = !row.enabled
    showError(error)
  }
}

function openEdit(row: Monitor) {
  editingMonitor.value = row
  editRule.value = row.ruleExpression
  editDialogVisible.value = true
}

async function saveEdit() {
  if (!editingMonitor.value) return

  if (!editRule.value.trim()) {
    ElMessage.warning('规则表达式不能为空')
    return
  }

  try {
    await api.updateMonitor(editingMonitor.value.id, {
      ruleExpression: editRule.value.trim(),
    })
    editDialogVisible.value = false
    ElMessage.success('规则已更新')
    await load()
  } catch (error) {
    showError(error)
  }
}

async function remove(row: Monitor) {
  try {
    await confirmDanger(
      `删除 Monitor #${row.id}？历史站内信会保留，但解除 Monitor 引用。`,
    )
    await api.deleteMonitor(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    showError(error)
  }
}

async function check(row: Monitor) {
  if (!row.ruleExpression.trim()) {
    ElMessage.warning('请先为该 SKU 映射应用价格规则')
    return
  }

  try {
    const result = await api.check(row.id)

    if (result.status === 'normal') {
      ElMessage.success(
        `正常：官方 ¥${result.official?.price.toFixed(2)} / 自店 ¥${result.own?.price.toFixed(2)}`,
      )
    } else if (result.status === 'violation') {
      ElMessage.warning(
        `违规：官方 ¥${result.official?.price.toFixed(2)} / 自店 ¥${result.own?.price.toFixed(2)}`,
      )
    } else {
      ElMessage.error(result.error || '检测失败')
    }

    await load()
  } catch (error) {
    showError(error)
  }
}

async function checkAll() {
  try {
    const result = await api.checkAll()
    ElMessage.success(`已提交 ${result.enqueued} 条检测任务`)

    // Queue 是异步消费的；稍后主动拉一次，除此之外还有 10 秒轮询兜底。
    window.setTimeout(() => {
      void refreshMonitorRows()
    }, 2_500)
  } catch (error) {
    showError(error)
  }
}

const MONITOR_STATUS_REFRESH_MS = 10_000
let monitorRefreshTimer: number | undefined

/**
 * 只刷新 Monitor 行，不重复请求商品和规则模板。
 *
 * Cron + Queue 在服务端异步更新 lastStatus / lastCheckedAt，浏览器不会自动知道 D1 已变化，
 * 因此需要轻量轮询。用户正在批量勾选、编辑或新建时暂停刷新，避免表格数据替换导致
 * Element Plus selection 状态丢失或操作对象被替换。
 */
async function refreshMonitorRows() {
  const userIsOperating =
    selectedRows.value.length > 0 ||
    createDialogVisible.value ||
    editDialogVisible.value ||
    createSaving.value ||
    applyingRule.value ||
    loading.value

  if (userIsOperating) return

  try {
    rows.value = await api.monitors()
  } catch (error) {
    // 自动刷新失败不弹 Toast，避免网络抖动时重复打扰用户。
    console.warn('刷新价格监控状态失败', error)
  }
}

/** 把后端时间统一格式化为管理端可读的本地日期时间。 */
function formatCheckedAt(value: string | number | null) {
  if (value === null || value === undefined || value === '') return '-'

  const date = typeof value === 'number'
    ? new Date(value < 10_000_000_000 ? value * 1000 : value)
    : new Date(value)

  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

onMounted(async () => {
  await load()

  monitorRefreshTimer = window.setInterval(
    refreshMonitorRows,
    MONITOR_STATUS_REFRESH_MS,
  )
})

onUnmounted(() => {
  if (monitorRefreshTimer !== undefined) {
    window.clearInterval(monitorRefreshTimer)
  }
})
</script>

<template>
  <section>
    <div class="page-head">
      <div>
        <h2>价格监控</h2>
        <p>
          先建立官方 SKU 与自店 SKU 的映射；映射完成后，在下方表格统一勾选并应用价格规则。
        </p>
      </div>
      <div>
        <el-button @click="checkAll">检测全部</el-button>
        <el-button type="primary" @click="openCreate">新增 SKU 映射</el-button>
      </div>
    </div>

    <!--
      批量规则工具栏放在表格正上方：
      用户完成所有 SKU 映射后，不需要重新打开“新增”对话框，直接勾选表格行即可应用规则。
    -->
    <div class="bulk-rule-toolbar">
      <div class="bulk-rule-main">
        <span class="selection-count">
          已勾选 <strong>{{ selectedCount }}</strong> 条
          <span v-if="selectedCount > MAX_BATCH_MONITORS" class="selection-limit">
            （单次最多 {{ MAX_BATCH_MONITORS }} 条）
          </span>
        </span>

        <el-select
          v-model="bulkPresetId"
          clearable
          filterable
          placeholder="选择常用规则"
          style="width: 300px"
        >
          <el-option
            v-for="preset in presets"
            :key="preset.id"
            :label="preset.name"
            :value="preset.id"
          >
            <div class="rule-option">
              <span>{{ preset.name }}</span>
              <small>{{ preset.expression }}</small>
            </div>
          </el-option>
        </el-select>

        <el-checkbox v-model="enableAfterApply">
          应用后启用
        </el-checkbox>

        <el-button
          type="primary"
          :disabled="!canApplyRule"
          :loading="applyingRule"
          @click="applyRuleToSelection"
        >
          应用到已选
        </el-button>
      </div>

      <div v-if="selectedPreset" class="selected-rule-preview">
        当前规则：
        <strong>{{ selectedPreset.name }}</strong>
        <code>{{ selectedPreset.expression }}</code>
      </div>
      <div v-else class="selected-rule-preview muted">
        表格左侧复选框支持多选/全选；选择“常用规则”后一次应用到所有已勾选映射。
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      stripe
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column prop="id" label="ID" width="70" />

      <el-table-column label="官方 SKU" min-width="210">
        <template #default="{ row }">
          <a
            v-if="row.referenceSku"
            :href="row.referenceSku.url"
            target="_blank"
          >
            {{ row.referenceSku.name }}
          </a>
          <span v-else>已删除</span>
        </template>
      </el-table-column>

      <el-table-column label="自店 SKU" min-width="210">
        <template #default="{ row }">
          <a
            v-if="row.targetSku"
            :href="row.targetSku.url"
            target="_blank"
          >
            {{ row.targetSku.name }}
          </a>
          <span v-else>已删除</span>
        </template>
      </el-table-column>

      <el-table-column label="规则" min-width="190">
        <template #default="{ row }">
          <span v-if="row.ruleExpression">
            {{ row.ruleExpression }}
          </span>
          <el-tag v-else type="info" effect="plain">
            未配置
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag
            v-if="!row.ruleExpression"
            type="info"
          >
            待配置
          </el-tag>
          <el-tag
            v-else
            :type="
              row.lastStatus === 'normal'
                ? 'success'
                : row.lastStatus === 'violation'
                  ? 'danger'
                  : row.lastStatus === 'fetch_error'
                    ? 'warning'
                    : 'info'
            "
          >
            {{ row.lastStatus }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="最近检测" width="175">
        <template #default="{ row }">
          <span class="last-checked-at">{{ formatCheckedAt(row.lastCheckedAt) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-tooltip
            :disabled="Boolean(row.ruleExpression)"
            content="请先应用价格规则"
            placement="top"
          >
            <span>
              <el-switch
                v-model="row.enabled"
                :disabled="!row.ruleExpression"
                @change="toggle(row)"
              />
            </span>
          </el-tooltip>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :disabled="!row.enabled || !row.ruleExpression"
            @click="check(row)"
          >
            检测
          </el-button>
          <el-button link @click="openEdit(row)">规则</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!--
      新建 SKU 映射对话框：
      这里只处理“谁和谁对应”，不再让用户提前选择规则。
    -->
    <el-dialog
      v-model="createDialogVisible"
      title="新增 SKU 映射"
      width="820"
      destroy-on-close
    >
      <el-alert
        title="这里只建立 SKU 对应关系。完成全部映射后，请回到价格监控列表勾选多行，再统一应用常用规则。"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 18px"
      />

      <el-form label-width="110">
        <el-form-item label="逻辑商品">
          <el-select
            v-model="createForm.productId"
            filterable
            style="width: 100%"
            @change="loadSkuOptions"
          >
            <el-option
              v-for="product in activeProducts"
              :key="product.id"
              :label="product.name"
              :value="product.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="官方 SKU">
          <div class="batch-select-wrap">
            <el-select
              v-model="createForm.referenceSkuIds"
              multiple
              filterable
              clearable
              collapse-tags
              collapse-tags-tooltip
              placeholder="可多选官方 SKU"
              style="width: 100%"
            >
              <el-option
                v-for="sku in officialSkus"
                :key="sku.id"
                :label="`${sku.name} · ${sku.shopName || sku.listingTitle}`"
                :value="sku.id"
              />
            </el-select>
            <el-button
              :disabled="officialSkus.length === 0"
              @click="selectAllOfficial"
            >
              全选
            </el-button>
          </div>
        </el-form-item>

        <el-form-item label="自店 SKU">
          <div class="batch-select-wrap">
            <el-select
              v-model="createForm.targetSkuIds"
              multiple
              filterable
              clearable
              collapse-tags
              collapse-tags-tooltip
              placeholder="可多选自店 SKU"
              style="width: 100%"
            >
              <el-option
                v-for="sku in ownSkus"
                :key="sku.id"
                :label="`${sku.name} · ${sku.shopName || sku.listingTitle}`"
                :value="sku.id"
              />
            </el-select>
            <el-button
              :disabled="ownSkus.length === 0"
              @click="selectAllOwn"
            >
              全选
            </el-button>
          </div>
        </el-form-item>

        <el-form-item label="配对方式">
          <el-radio-group v-model="createForm.pairingMode">
            <el-radio-button value="zip">按选择顺序一一配对</el-radio-button>
            <el-radio-button value="cartesian">全部组合</el-radio-button>
          </el-radio-group>
          <div class="hint pairing-hint">
            一一配对要求两侧数量相同；全部组合会生成“官方数量 × 自店数量”条映射。
          </div>
        </el-form-item>

        <el-form-item label="配对预览">
          <div class="pair-preview">
            <el-alert
              v-if="pairValidationMessage"
              :title="pairValidationMessage"
              type="warning"
              :closable="false"
              show-icon
            />

            <template v-else>
              <div class="pair-summary">
                本次将新增
                <strong>{{ generatedPairs.length }}</strong>
                条 SKU 映射
                <span v-if="generatedPairs.length > pairPreview.length">
                  （下表仅预览前 {{ pairPreview.length }} 条）
                </span>
              </div>

              <el-table
                :data="pairPreview"
                size="small"
                border
                max-height="260"
              >
                <el-table-column
                  prop="referenceName"
                  label="官方 SKU"
                  min-width="250"
                />
                <el-table-column
                  prop="targetName"
                  label="自店 SKU"
                  min-width="250"
                />
              </el-table>
            </template>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="createSaving"
          :disabled="!canCreateMapping"
          @click="saveMappings"
        >
          新增 {{ generatedPairs.length || '' }} 条映射
        </el-button>
      </template>
    </el-dialog>

    <!-- 单条规则编辑继续保留，用于少量例外 SKU。 -->
    <el-dialog
      v-model="editDialogVisible"
      title="修改监控规则"
      width="520"
    >
      <el-input v-model="editRule" />
      <div class="hint">
        单条修改只影响当前 Monitor；大批量设置请使用列表顶部“应用到已选”。
      </div>

      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>
