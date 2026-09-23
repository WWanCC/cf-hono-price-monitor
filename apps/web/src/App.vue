<!--
  管理端根组件。
  为了让初学者容易跟踪，脚本部分按“状态 → 计算属性 → 操作 → 生命周期”组织；
  模板部分按侧边导航对应的页面组织。后续页面继续增长时，建议拆成多个子组件。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Bell,
  Box,
  Connection,
  DataAnalysis,
  Goods,
  HomeFilled,
  Message,
  Plus,
  Refresh,
  Setting,
  Shop,
  SwitchButton,
} from '@element-plus/icons-vue'
import {
  ApiError,
  api,
  type AdminUser,
  type Brand,
  type CheckResult,
  type Listing,
  type ListingSku,
  type Monitor,
  type Notification,
  type Product,
  type RulePreset,
  type Supplier,
  type TokenSetting,
} from './api'

type Page =
  | 'dashboard'
  | 'products'
  | 'mapping'
  | 'monitors'
  | 'suppliers'
  | 'brands'
  | 'notifications'
  | 'system'

// authReady 防止首次请求完成前闪现登录页；admin 决定当前显示登录页还是管理工作台。
const authReady = ref(false)
const admin = ref<AdminUser | null>(null)
const loginLoading = ref(false)
const loginForm = reactive({ username: '', password: '' })

const page = ref<Page>('dashboard')
const loading = ref(false)
const products = ref<Product[]>([])
const brands = ref<Brand[]>([])
const suppliers = ref<Supplier[]>([])
const monitors = ref<Monitor[]>([])
const notifications = ref<Notification[]>([])
const unreadCount = ref(0)
let notificationTimer: number | null = null

const selectedProductId = ref<number>()
const listings = ref<Listing[]>([])
const officialSkus = ref<ListingSku[]>([])
const ownSkus = ref<ListingSku[]>([])
const importing = ref<'official' | 'own' | null>(null)
const checking = ref<number | null>(null)
const queueing = ref(false)
const result = ref<CheckResult | null>(null)
const resultVisible = ref(false)

const links = reactive({ official: '', own: '' })
const mapping = reactive({
  referenceSkuId: undefined as number | undefined,
  targetSkuId: undefined as number | undefined,
  ruleExpression: 'own >= official',
})

const rulePresets = ref<RulePreset[]>([])
const rulePresetDlg = ref(false)
const rulePresetSaving = ref(false)
const editingRulePresetId = ref<number | null>(null)
const rulePresetForm = reactive({
  name: '',
  expression: 'own >= official',
})

const productDlg = ref(false)
const brandDlg = ref(false)
const supplierDlg = ref(false)
const pf = reactive({
  name: '',
  brandId: undefined as number | undefined,
  supplierId: undefined as number | undefined,
  supplierProductUrl: '',
  note: '',
})
const bf = reactive({ name: '', note: '' })
const sf = reactive({ name: '', shopName: '', shopUrl: '', note: '' })

const apiStatus = ref<'checking' | 'online' | 'offline'>('checking')
const tokenSetting = ref<TokenSetting | null>(null)
const tokenSaving = ref(false)
const tokenForm = reactive({ token: '', validationUrl: '' })
const accountSaving = ref(false)
const accountForm = reactive({
  username: '',
  currentPassword: '',
  newPassword: '',
})

const titles: Record<Page, string> = {
  dashboard: '概览',
  products: '商品管理',
  mapping: 'SKU 映射',
  monitors: '价格监控',
  suppliers: '上游厂家',
  brands: '品牌管理',
  notifications: '站内信',
  system: '系统设置',
}

const menu = [
  ['dashboard', '概览', HomeFilled],
  ['products', '商品管理', Goods],
  ['mapping', 'SKU 映射', Connection],
  ['monitors', '价格监控', DataAnalysis],
  ['suppliers', '上游厂家', Shop],
  ['brands', '品牌管理', Box],
  ['notifications', '站内信', Message],
  ['system', '系统设置', Setting],
] as const

// 统计值从同一份 monitors/products 响应式数据派生，避免单独维护容易失真的计数。
const stats = computed(() => ({
  products: products.value.length,
  monitors: monitors.value.length,
  normal: monitors.value.filter((item) => item.lastStatus === 'normal').length,
  alerts: monitors.value.filter(
    (item) => item.lastStatus === 'violation' || item.lastStatus === 'fetch_error',
  ).length,
}))

const officialListing = computed(() =>
  listings.value.find((item) => item.role === 'official'),
)
const ownListing = computed(() =>
  listings.value.find((item) => item.role === 'own'),
)
const currentMappings = computed(() => {
  const official = new Set(officialSkus.value.map((item) => item.id))
  const own = new Set(ownSkus.value.map((item) => item.id))
  return monitors.value.filter(
    (item) => official.has(item.referenceSkuId) && own.has(item.targetSkuId),
  )
})

function handleError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    admin.value = null
    ElMessage.warning('登录已过期，请重新登录')
    return
  }
  ElMessage.error(error instanceof Error ? error.message : '操作失败')
}

function fmt(value: string | number | null) {
  if (!value) return '尚未检测'
  const date =
    typeof value === 'number'
      ? new Date(value < 1e10 ? value * 1000 : value)
      : new Date(value)
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('zh-CN', { hour12: false })
}

function statusText(status: Monitor['lastStatus']) {
  return {
    pending: '待检测',
    normal: '正常',
    violation: '价格异常',
    fetch_error: '获取失败',
  }[status]
}

function statusType(status: Monitor['lastStatus']) {
  return (
    {
      pending: 'info',
      normal: 'success',
      violation: 'danger',
      fetch_error: 'warning',
    } as const
  )[status]
}

function skuName(id: number, kind: 'official' | 'own') {
  return (kind === 'official' ? officialSkus.value : ownSkus.value)
    .find((item) => item.id === id)?.name || `SKU #${id}`
}

// 登录成功后一次性加载页面所需数据，并启动站内信轮询。
async function login() {
  if (!loginForm.username.trim() || !loginForm.password) {
    ElMessage.warning('请输入账号和密码')
    return
  }

  loginLoading.value = true
  try {
    admin.value = await api.login({
      username: loginForm.username.trim(),
      password: loginForm.password,
    })
    accountForm.username = admin.value.username
    loginForm.password = ''
    await load()
    await loadNotifications()
    await loadTokenSetting()
    startNotificationPolling()
  } catch (error) {
    handleError(error)
  } finally {
    loginLoading.value = false
  }
}

async function logout() {
  try {
    await api.logout()
  } catch {
    // 即使服务端 Session 已失效，也直接回登录页。
  }
  admin.value = null
  products.value = []
  monitors.value = []
  notifications.value = []
  unreadCount.value = 0
  if (notificationTimer !== null) {
    window.clearInterval(notificationTimer)
    notificationTimer = null
  }
}

// 工作台的基础数据并行加载，减少多个串行请求造成的首屏等待。
async function load() {
  if (!admin.value) return
  loading.value = true
  try {
    ;[
      products.value,
      brands.value,
      suppliers.value,
      monitors.value,
      rulePresets.value,
    ] = await Promise.all([
      api.products(),
      api.brands(),
      api.suppliers(),
      api.monitors(),
      api.rulePresets(),
    ])

    if (!selectedProductId.value && products.value[0]) {
      selectedProductId.value = products.value[0].id
    }
  } catch (error) {
    handleError(error)
  } finally {
    loading.value = false
  }
}

// 切换商品时清空旧 SKU，避免新商品加载期间误显示上一商品的数据。
async function loadListings() {
  officialSkus.value = []
  ownSkus.value = []
  listings.value = []
  if (!selectedProductId.value || !admin.value) return

  try {
    listings.value = await api.listings(selectedProductId.value)
    const official = officialListing.value
    const own = ownListing.value
    links.official = official?.url || ''
    links.own = own?.url || ''

    ;[officialSkus.value, ownSkus.value] = await Promise.all([
      official ? api.skus(official.id) : Promise.resolve([]),
      own ? api.skus(own.id) : Promise.resolve([]),
    ])
  } catch (error) {
    handleError(error)
  }
}

async function importOne(role: 'official' | 'own') {
  if (!selectedProductId.value) return ElMessage.warning('先选择商品')
  if (!links[role].trim()) return ElMessage.warning('请先粘贴商品链接')

  importing.value = role
  try {
    const data = await api.importListing({
      productId: selectedProductId.value,
      role,
      content: links[role].trim(),
    })
    ElMessage.success(`解析成功，共 ${data.skuCount} 个 SKU`)
    await loadListings()
  } catch (error) {
    handleError(error)
  } finally {
    importing.value = null
  }
}

async function createMap() {
  if (!mapping.referenceSkuId || !mapping.targetSkuId) {
    return ElMessage.warning('请选择两侧 SKU')
  }

  try {
    await api.createMonitor({
      referenceSkuId: mapping.referenceSkuId,
      targetSkuId: mapping.targetSkuId,
      ruleExpression: mapping.ruleExpression.trim(),
    })
    ElMessage.success('映射已保存')
    monitors.value = await api.monitors()
    mapping.referenceSkuId = undefined
    mapping.targetSkuId = undefined
  } catch (error) {
    handleError(error)
  }
}

async function checkOne(id: number) {
  checking.value = id
  try {
    result.value = await api.check(id)
    resultVisible.value = true
    monitors.value = await api.monitors()
    await loadNotifications()
  } catch (error) {
    handleError(error)
  } finally {
    checking.value = null
  }
}

// Queue 是异步的，所以提交成功只代表入队；这里延迟刷新一次让用户看到后台处理后的状态。
async function checkAll() {
  queueing.value = true
  try {
    const data = await api.checkAll()
    ElMessage.success(
      `已提交 ${data.enqueued} 条检测任务，正在后台处理`,
    )
    window.setTimeout(async () => {
      if (!admin.value) return
      try {
        monitors.value = await api.monitors()
        await loadNotifications()
      } catch {
        // 只做一次无提示刷新，不影响主流程。
      }
    }, 3000)
  } catch (error) {
    handleError(error)
  } finally {
    queueing.value = false
  }
}

async function addProduct() {
  if (!pf.name.trim() || !pf.brandId) {
    return ElMessage.warning('填写商品名称并选择品牌')
  }
  try {
    await api.createProduct({
      name: pf.name.trim(),
      brandId: pf.brandId,
      supplierId: pf.supplierId ?? null,
      supplierProductUrl: pf.supplierProductUrl.trim() || null,
      note: pf.note.trim() || null,
    })
    productDlg.value = false
    Object.assign(pf, {
      name: '',
      brandId: undefined,
      supplierId: undefined,
      supplierProductUrl: '',
      note: '',
    })
    await load()
    ElMessage.success('商品已创建')
  } catch (error) {
    handleError(error)
  }
}

async function addBrand() {
  if (!bf.name.trim()) return
  try {
    await api.createBrand({
      name: bf.name.trim(),
      note: bf.note.trim() || undefined,
    })
    brandDlg.value = false
    Object.assign(bf, { name: '', note: '' })
    await load()
  } catch (error) {
    handleError(error)
  }
}

async function addSupplier() {
  if (!sf.name.trim()) return
  try {
    await api.createSupplier({
      name: sf.name.trim(),
      shopName: sf.shopName.trim() || null,
      shopUrl: sf.shopUrl.trim() || null,
      note: sf.note.trim() || null,
    })
    supplierDlg.value = false
    Object.assign(sf, { name: '', shopName: '', shopUrl: '', note: '' })
    await load()
  } catch (error) {
    handleError(error)
  }
}

async function health() {
  apiStatus.value = 'checking'
  try {
    await api.health()
    apiStatus.value = 'online'
  } catch {
    apiStatus.value = 'offline'
  }
}

async function loadTokenSetting() {
  if (!admin.value) return
  try {
    tokenSetting.value = await api.tokenSetting()
  } catch (error) {
    handleError(error)
  }
}

async function saveToken() {
  if (!tokenForm.token.trim()) {
    return ElMessage.warning('请输入新的喵喵折 Token')
  }
  tokenSaving.value = true
  try {
    tokenSetting.value = await api.saveToken(
      tokenForm.token,
      tokenForm.validationUrl.trim() || undefined,
    )
    tokenForm.token = ''
    tokenForm.validationUrl = ''
    ElMessage.success('Token 验证通过并已保存')
  } catch (error) {
    handleError(error)
  } finally {
    tokenSaving.value = false
  }
}

function openRulePresetCreate() {
  editingRulePresetId.value = null
  rulePresetForm.name = ''
  rulePresetForm.expression = mapping.ruleExpression || 'own >= official'
  rulePresetDlg.value = true
}

function editRulePreset(item: RulePreset) {
  editingRulePresetId.value = item.id
  rulePresetForm.name = item.name
  rulePresetForm.expression = item.expression
  rulePresetDlg.value = true
}

async function saveRulePreset() {
  if (!rulePresetForm.name.trim()) {
    return ElMessage.warning('请输入常用规则名称')
  }

  if (!rulePresetForm.expression.trim()) {
    return ElMessage.warning('请输入规则表达式')
  }

  rulePresetSaving.value = true
  try {
    if (editingRulePresetId.value) {
      await api.updateRulePreset(
        editingRulePresetId.value,
        {
          name: rulePresetForm.name.trim(),
          expression: rulePresetForm.expression.trim(),
        },
      )
      ElMessage.success('常用规则已更新')
    } else {
      await api.createRulePreset({
        name: rulePresetForm.name.trim(),
        expression: rulePresetForm.expression.trim(),
      })
      ElMessage.success('常用规则已创建')
    }

    rulePresets.value = await api.rulePresets()
    rulePresetDlg.value = false
  } catch (error) {
    handleError(error)
  } finally {
    rulePresetSaving.value = false
  }
}

async function deleteRulePreset(item: RulePreset) {
  try {
    await ElMessageBox.confirm(
      `确认删除常用规则“${item.name}”吗？`,
      '删除常用规则',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }

  try {
    await api.deleteRulePreset(item.id)
    rulePresets.value = await api.rulePresets()
    ElMessage.success('常用规则已删除')
  } catch (error) {
    handleError(error)
  }
}

function useRulePreset(item: RulePreset) {
  mapping.ruleExpression = item.expression
  ElMessage.success(`已应用：${item.name}`)
}

async function updateAccount() {
  if (!accountForm.currentPassword) {
    return ElMessage.warning('请输入当前密码')
  }
  if (accountForm.newPassword && accountForm.newPassword.length < 8) {
    return ElMessage.warning('新密码至少 8 位')
  }

  accountSaving.value = true
  try {
    admin.value = await api.updateAccount({
      currentPassword: accountForm.currentPassword,
      username: accountForm.username.trim() || undefined,
      newPassword: accountForm.newPassword || undefined,
    })
    accountForm.username = admin.value.username
    accountForm.currentPassword = ''
    accountForm.newPassword = ''
    ElMessage.success('登录账号设置已更新')
  } catch (error) {
    handleError(error)
  } finally {
    accountSaving.value = false
  }
}

function startNotificationPolling() {
  if (notificationTimer !== null) window.clearInterval(notificationTimer)
  notificationTimer = window.setInterval(async () => {
    if (!admin.value) return
    try {
      unreadCount.value = (await api.unreadCount()).count
    } catch {
      // 后台轮询不弹错误，避免干扰操作。
    }
  }, 30_000)
}

async function loadNotifications(showError = true) {
  if (!admin.value) return
  try {
    const [items, unread] = await Promise.all([
      api.notifications(),
      api.unreadCount(),
    ])
    notifications.value = items
    unreadCount.value = unread.count
  } catch (error) {
    if (showError) handleError(error)
  }
}

async function openNotification(item: Notification) {
  if (!item.read) {
    try {
      await api.readNotification(item.id)
      item.read = true
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    } catch (error) {
      handleError(error)
    }
  }
}

async function readAll() {
  try {
    await api.readAllNotifications()
    notifications.value.forEach((item) => (item.read = true))
    unreadCount.value = 0
    ElMessage.success('已全部标记为已读')
  } catch (error) {
    handleError(error)
  }
}

// 商品选择变化是 SKU 映射页的关键依赖；watch 负责重新读取两类 Listing/SKU。
watch(selectedProductId, loadListings)
watch(page, async (value) => {
  if (value === 'notifications') await loadNotifications()
  if (value === 'system') {
    await loadTokenSetting()
    await health()
  }
})

onBeforeUnmount(() => {
  if (notificationTimer !== null) window.clearInterval(notificationTimer)
})

// 首次挂载先尝试恢复 Cookie Session；401 只意味着显示登录页，其他错误才提示用户。
onMounted(async () => {
  try {
    admin.value = await api.me()
    accountForm.username = admin.value.username
    await load()
    await loadListings()
    await loadNotifications(false)
    await loadTokenSetting()
    await health()
    startNotificationPolling()
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      handleError(error)
    }
  } finally {
    authReady.value = true
  }
})
</script>

<!-- 页面按照 Page 联合类型分支渲染；共享的侧边栏和顶部栏只在已登录时出现。 -->
<template>
  <div v-if="!authReady" class="auth-loading">正在加载管理端…</div>

  <div v-else-if="!admin" class="login-page">
    <div class="login-card">
      <div class="login-logo">P</div>
      <small>PRICE MONITOR</small>
      <h1>店铺价格监控</h1>
      <p>请输入管理员账号与密码后进入后台。</p>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="登录账号">
          <el-input
            v-model="loginForm.username"
            size="large"
            autocomplete="username"
            @keyup.enter="login"
          />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input
            v-model="loginForm.password"
            type="password"
            show-password
            size="large"
            autocomplete="current-password"
            @keyup.enter="login"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="login-submit"
          :loading="loginLoading"
          @click="login"
        >
          登录
        </el-button>
      </el-form>
      <div class="login-hint">
        初始账号由 <code>.dev.vars</code> / Worker Secret 中的
        ADMIN_USERNAME、ADMIN_PASSWORD 创建。
      </div>
    </div>
  </div>

  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">P</div>
        <div><strong>Price Monitor</strong><span>店铺价格监控</span></div>
      </div>

      <nav>
        <button
          v-for="[key, label, icon] in menu"
          :key="key"
          :class="{ active: page === key }"
          @click="page = key"
        >
          <el-icon><component :is="icon" /></el-icon>
          <span>{{ label }}</span>
          <b
            v-if="key === 'notifications' && unreadCount > 0"
            class="menu-badge"
          >{{ unreadCount > 99 ? '99+' : unreadCount }}</b>
        </button>
      </nav>

      <div class="side-status">
        <i></i>
        <div><strong>监控服务</strong><span>Cloudflare Worker</span></div>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <small>OPERATIONS CONSOLE</small>
          <h1>{{ titles[page] }}</h1>
        </div>
        <div class="top-actions">
          <el-badge :value="unreadCount" :hidden="unreadCount === 0">
            <el-button circle @click="page = 'notifications'">
              <el-icon><Bell /></el-icon>
            </el-button>
          </el-badge>
          <div class="profile">
            <div class="avatar">PM</div>
            <div><b>{{ admin.username }}</b><span>Administrator</span></div>
          </div>
          <el-button text :icon="SwitchButton" @click="logout">退出</el-button>
        </div>
      </header>

      <main v-loading="loading">
        <!-- 概览：展示统计卡片和最近监控。 -->
        <template v-if="page === 'dashboard'">
          <div class="hero">
            <div>
              <em>PRICE CONTROL</em>
              <h2>店铺价格监控总览</h2>
              <p>统一查看商品、SKU 映射与控价异常，Queue 承担批量检测，Cron 每天自动触发三次。</p>
            </div>
            <div class="hero-actions">
              <el-button :icon="Refresh" @click="load">刷新</el-button>
              <el-button type="primary" :loading="queueing" @click="checkAll">检测全部</el-button>
            </div>
          </div>

          <div class="metrics">
            <article><span>商品数量</span><strong>{{ stats.products }}</strong><small>逻辑商品</small></article>
            <article><span>监控关系</span><strong>{{ stats.monitors }}</strong><small>官方 → 自店 SKU</small></article>
            <article class="ok"><span>当前正常</span><strong>{{ stats.normal }}</strong><small>最近检测通过</small></article>
            <article class="bad"><span>需要处理</span><strong>{{ stats.alerts }}</strong><small>违规 / 获取失败</small></article>
          </div>

          <div class="panel">
            <div class="panel-head">
              <div><h3>最近监控</h3><p>违规时会自动生成站内信；正常结果不会提醒。</p></div>
              <button class="link-btn" @click="page = 'monitors'">查看全部 →</button>
            </div>
            <el-table :data="monitors.slice(-8).reverse()">
              <el-table-column prop="id" label="ID" width="70" />
              <el-table-column label="官方 SKU" min-width="230">
                <template #default="{ row }">
                  <div v-if="row.referenceSku" class="sku-cell">
                    <a :href="row.referenceSku.url" target="_blank" rel="noreferrer" class="sku-link">{{ row.referenceSku.name }}</a>
                    <span>#{{ row.referenceSkuId }} · skuId {{ row.referenceSku.externalSkuId }}</span>
                  </div>
                  <span v-else>#{{ row.referenceSkuId }}</span>
                </template>
              </el-table-column>
              <el-table-column label="自店 SKU" min-width="230">
                <template #default="{ row }">
                  <div v-if="row.targetSku" class="sku-cell">
                    <a :href="row.targetSku.url" target="_blank" rel="noreferrer" class="sku-link">{{ row.targetSku.name }}</a>
                    <span>#{{ row.targetSkuId }} · skuId {{ row.targetSku.externalSkuId }}</span>
                  </div>
                  <span v-else>#{{ row.targetSkuId }}</span>
                </template>
              </el-table-column>
              <el-table-column label="规则" min-width="220"><template #default="{ row }"><code>{{ row.ruleExpression }}</code></template></el-table-column>
              <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="statusType(row.lastStatus)" round>{{ statusText(row.lastStatus) }}</el-tag></template></el-table-column>
              <el-table-column label="最近检测" min-width="180"><template #default="{ row }">{{ fmt(row.lastCheckedAt) }}</template></el-table-column>
              <el-table-column width="110"><template #default="{ row }"><el-button text type="primary" :loading="checking === row.id" @click="checkOne(row.id)">立即检测</el-button></template></el-table-column>
            </el-table>
          </div>
        </template>

        <template v-else-if="page === 'products'">
          <div class="page-head">
            <div><h2>商品管理</h2><p>逻辑商品关联品牌、1688 上游、官方 Listing 与自店 Listing。</p></div>
            <el-button type="primary" :icon="Plus" @click="productDlg = true">新增商品</el-button>
          </div>
          <div class="panel">
            <el-table :data="products">
              <el-table-column prop="id" label="ID" width="70" />
              <el-table-column label="商品" min-width="220"><template #default="{ row }"><div class="primary"><b>{{ row.name }}</b><span>{{ row.note || '暂无备注' }}</span></div></template></el-table-column>
              <el-table-column prop="brandName" label="品牌" />
              <el-table-column label="上游厂家"><template #default="{ row }">{{ row.supplierName || '未关联' }}</template></el-table-column>
              <el-table-column label="1688"><template #default="{ row }"><a v-if="row.supplierProductUrl" :href="row.supplierProductUrl" target="_blank">打开货源</a><span v-else class="muted">未填写</span></template></el-table-column>
              <el-table-column label="操作" width="110"><template #default="{ row }"><el-button text type="primary" @click="selectedProductId = row.id; page = 'mapping'">SKU 映射</el-button></template></el-table-column>
            </el-table>
          </div>
        </template>

        <template v-else-if="page === 'mapping'">
          <div class="page-head">
            <div><h2>SKU 映射</h2><p>官方与自店都走喵喵折解析，再建立真实 SKU 的监控关系。</p></div>
            <el-select v-model="selectedProductId" filterable style="width: 300px"><el-option v-for="p in products" :key="p.id" :label="`${p.brandName} / ${p.name}`" :value="p.id" /></el-select>
          </div>
          <div class="mapping-flow">
            <article class="link-card official">
              <small>01 / OFFICIAL</small><h3>官方旗舰店</h3><p>粘贴淘宝 / 天猫链接，解析 itemId、SKU 与 providerRef。</p>
              <el-input v-model="links.official" type="textarea" :rows="4" />
              <footer><span>{{ officialListing ? `已解析 · ${officialSkus.length} SKU` : '尚未导入' }}</span><el-button type="primary" :loading="importing === 'official'" @click="importOne('official')">解析并保存</el-button></footer>
            </article>
            <div class="connector">↔<span>SKU Mapping</span></div>
            <article class="link-card own">
              <small>02 / SELF STORE</small><h3>我的店铺</h3><p>解析自店真实 SKU，与官方 SKU 一对一或一对多映射。</p>
              <el-input v-model="links.own" type="textarea" :rows="4" />
              <footer><span>{{ ownListing ? `已解析 · ${ownSkus.length} SKU` : '尚未导入' }}</span><el-button type="primary" :loading="importing === 'own'" @click="importOne('own')">解析并保存</el-button></footer>
            </article>
          </div>
          <div class="panel">
            <div class="panel-head"><div><h3>建立监控关系</h3><p>official 为官方价，own 为自店价。</p></div></div>
            <div class="mapping-form">
              <el-select v-model="mapping.referenceSkuId" filterable placeholder="官方 SKU"><el-option v-for="s in officialSkus" :key="s.id" :label="`${s.name} · skuId ${s.externalSkuId}`" :value="s.id" /></el-select>
              <span>→</span>
              <el-select v-model="mapping.targetSkuId" filterable placeholder="自店 SKU"><el-option v-for="s in ownSkus" :key="s.id" :label="`${s.name} · skuId ${s.externalSkuId}`" :value="s.id" /></el-select>
              <el-input v-model="mapping.ruleExpression" />
              <el-button type="primary" @click="createMap">保存映射</el-button>
            </div>
            <div class="chips">
              <span>常用规则</span>
              <button
                v-for="preset in rulePresets"
                :key="preset.id"
                @click="mapping.ruleExpression = preset.expression"
              >
                {{ preset.name }}
              </button>
              <button class="manage-rule-btn" @click="openRulePresetCreate">＋ 自定义常用规则</button>
            </div>
          </div>
          <div class="panel">
            <div class="panel-head"><div><h3>当前映射</h3><p>同一官方 SKU 可以对应多个自店 SKU。</p></div><b>{{ currentMappings.length }} 条</b></div>
            <el-table :data="currentMappings">
              <el-table-column label="官方 SKU" min-width="310">
                <template #default="{ row }">
                  <div class="sku-cell">
                    <a
                      v-if="row.referenceSku"
                      :href="row.referenceSku.url"
                      target="_blank"
                      rel="noreferrer"
                      class="sku-link"
                    >{{ row.referenceSku.name }}</a>
                    <b v-else>{{ skuName(row.referenceSkuId, 'official') }}</b>
                    <span>
                      #{{ row.referenceSkuId }}
                      <template v-if="row.referenceSku"> · skuId {{ row.referenceSku.externalSkuId }}</template>
                    </span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column width="60"><template #default>→</template></el-table-column>
              <el-table-column label="自店 SKU" min-width="310">
                <template #default="{ row }">
                  <div class="sku-cell">
                    <a
                      v-if="row.targetSku"
                      :href="row.targetSku.url"
                      target="_blank"
                      rel="noreferrer"
                      class="sku-link"
                    >{{ row.targetSku.name }}</a>
                    <b v-else>{{ skuName(row.targetSkuId, 'own') }}</b>
                    <span>
                      #{{ row.targetSkuId }}
                      <template v-if="row.targetSku"> · skuId {{ row.targetSku.externalSkuId }}</template>
                    </span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="规则"><template #default="{ row }"><code>{{ row.ruleExpression }}</code></template></el-table-column>
            </el-table>
          </div>
        </template>

        <template v-else-if="page === 'monitors'">
          <div class="page-head">
            <div><h2>价格监控</h2><p>单条可立即检测；“检测全部”会提交所有启用 Monitor，由 Queue 在后台执行。</p></div>
            <div class="head-actions"><el-button :loading="queueing" @click="checkAll">检测全部</el-button><el-button type="primary" @click="page = 'mapping'">新增监控</el-button></div>
          </div>
          <div class="summary"><span>● 正常 {{ monitors.filter(i => i.lastStatus === 'normal').length }}</span><span class="red">● 违规 {{ monitors.filter(i => i.lastStatus === 'violation').length }}</span><span class="orange">● 获取失败 {{ monitors.filter(i => i.lastStatus === 'fetch_error').length }}</span></div>
          <div class="panel">
            <el-table :data="monitors">
              <el-table-column prop="id" label="ID" width="70" />
              <el-table-column label="官方 SKU" min-width="260">
                <template #default="{ row }">
                  <div v-if="row.referenceSku" class="sku-cell">
                    <a :href="row.referenceSku.url" target="_blank" rel="noreferrer" class="sku-link">{{ row.referenceSku.name }}</a>
                    <span>#{{ row.referenceSkuId }} · skuId {{ row.referenceSku.externalSkuId }}</span>
                  </div>
                  <span v-else>#{{ row.referenceSkuId }}</span>
                </template>
              </el-table-column>
              <el-table-column label="自店 SKU" min-width="260">
                <template #default="{ row }">
                  <div v-if="row.targetSku" class="sku-cell">
                    <a :href="row.targetSku.url" target="_blank" rel="noreferrer" class="sku-link">{{ row.targetSku.name }}</a>
                    <span>#{{ row.targetSkuId }} · skuId {{ row.targetSku.externalSkuId }}</span>
                  </div>
                  <span v-else>#{{ row.targetSkuId }}</span>
                </template>
              </el-table-column>
              <el-table-column label="规则" min-width="220"><template #default="{ row }"><code>{{ row.ruleExpression }}</code></template></el-table-column>
              <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="statusType(row.lastStatus)" round>{{ statusText(row.lastStatus) }}</el-tag></template></el-table-column>
              <el-table-column label="最近检测" min-width="180"><template #default="{ row }">{{ fmt(row.lastCheckedAt) }}</template></el-table-column>
              <el-table-column label="错误" min-width="180"><template #default="{ row }"><span :class="{ red: row.lastError }">{{ row.lastError || '—' }}</span></template></el-table-column>
              <el-table-column width="110"><template #default="{ row }"><el-button text type="primary" :loading="checking === row.id" @click="checkOne(row.id)">立即检测</el-button></template></el-table-column>
            </el-table>
          </div>
        </template>

        <template v-else-if="page === 'suppliers'">
          <div class="page-head"><div><h2>上游厂家</h2><p>保存 1688 厂家与店铺信息，方便采购和售后定位。</p></div><el-button type="primary" :icon="Plus" @click="supplierDlg = true">新增厂家</el-button></div>
          <div class="panel"><el-table :data="suppliers"><el-table-column prop="id" label="ID" width="70" /><el-table-column label="厂家"><template #default="{ row }"><div class="primary"><b>{{ row.name }}</b><span>{{ row.note || '暂无备注' }}</span></div></template></el-table-column><el-table-column label="1688 店铺"><template #default="{ row }">{{ row.shopName || '未填写' }}</template></el-table-column><el-table-column label="链接"><template #default="{ row }"><a v-if="row.shopUrl" :href="row.shopUrl" target="_blank">打开店铺</a><span v-else class="muted">未填写</span></template></el-table-column></el-table></div>
        </template>

        <template v-else-if="page === 'brands'">
          <div class="page-head"><div><h2>品牌管理</h2><p>品牌是逻辑商品的一级归属。</p></div><el-button type="primary" :icon="Plus" @click="brandDlg = true">新增品牌</el-button></div>
          <div class="brand-grid"><article v-for="b in brands" :key="b.id"><div class="brand-icon">{{ b.name.slice(0, 1).toUpperCase() }}</div><div><b>{{ b.name }}</b><p>{{ b.note || '暂无品牌备注' }}</p></div><el-tag :type="b.enabled ? 'success' : 'info'">{{ b.enabled ? '启用' : '停用' }}</el-tag></article><button class="add-card" @click="brandDlg = true">＋<b>新增品牌</b></button></div>
        </template>

        <template v-else-if="page === 'notifications'">
          <div class="page-head">
            <div><h2>站内信</h2><p>只在价格规则进入违规状态时提醒；正常检测和获取失败不会生成站内信。</p></div>
            <div class="head-actions"><el-button :icon="Refresh" @click="loadNotifications">刷新</el-button><el-button :disabled="unreadCount === 0" @click="readAll">全部已读</el-button></div>
          </div>
          <div class="panel notification-list">
            <div v-if="notifications.length === 0" class="empty-state">暂无站内信</div>
            <button
              v-for="item in notifications"
              :key="item.id"
              class="notice-row"
              :class="{ unread: !item.read }"
              @click="openNotification(item)"
            >
              <span class="notice-dot"></span>
              <div class="notice-main">
                <div class="notice-title"><b>{{ item.title }}</b><span>{{ fmt(item.createdAt) }}</span></div>
                <p>{{ item.content }}</p>
              </div>
              <el-tag v-if="!item.read" type="danger" effect="light" round>未读</el-tag>
              <el-tag v-else type="info" effect="plain" round>已读</el-tag>
            </button>
          </div>
        </template>

        <template v-else>
          <div class="page-head"><div><h2>系统设置</h2><p>管理喵喵折 Token、后台登录账号，以及查看 Worker 运行配置。</p></div><el-button @click="health">重新检测</el-button></div>

          <div class="settings-grid">
            <section class="panel setting-panel">
              <div class="panel-head"><div><h3>喵喵折 Token</h3><p>保存前会先请求喵喵折验证 Token 是否有效；验证通过后才写入 D1，并立即用于手动检测、Queue 和 Cron。</p></div></div>
              <div class="setting-body">
                <div class="setting-status"><span>当前状态</span><el-tag :type="tokenSetting?.configured ? 'success' : 'warning'">{{ tokenSetting?.configured ? '已配置' : '未配置' }}</el-tag></div>
                <div v-if="tokenSetting?.configured" class="masked-token">{{ tokenSetting.maskedToken }} <small>来源：{{ tokenSetting.source === 'database' ? '管理端保存' : '环境变量' }}</small></div>
                <el-form label-position="top">
                  <el-form-item label="输入新的 Token">
                    <el-input v-model="tokenForm.token" type="password" show-password placeholder="可直接粘贴 token 本体或 Bearer token" />
                  </el-form-item>
                  <el-form-item label="首次配置验证商品链接（没有历史商品时填写）">
                    <el-input v-model="tokenForm.validationUrl" placeholder="任意一个可正常访问的淘宝 / 天猫商品链接" />
                  </el-form-item>
                  <div class="setting-tip">
                    已有 Listing / SKU 时会自动用历史商品验证，可不填；全新数据库第一次配置 Token 时，请提供一个商品链接。
                  </div>
                  <el-button type="primary" :loading="tokenSaving" @click="saveToken">{{ tokenSaving ? '正在验证…' : '验证并保存 Token' }}</el-button>
                </el-form>
              </div>
            </section>

            <section class="panel setting-panel">
              <div class="panel-head"><div><h3>后台登录账号</h3><p>修改后下次登录使用新账号 / 新密码。修改时必须验证当前密码。</p></div></div>
              <div class="setting-body">
                <el-form label-position="top">
                  <el-form-item label="登录账号"><el-input v-model="accountForm.username" /></el-form-item>
                  <el-form-item label="当前密码"><el-input v-model="accountForm.currentPassword" type="password" show-password /></el-form-item>
                  <el-form-item label="新密码（不修改可留空）"><el-input v-model="accountForm.newPassword" type="password" show-password placeholder="至少 8 位" /></el-form-item>
                  <el-button type="primary" :loading="accountSaving" @click="updateAccount">更新登录设置</el-button>
                </el-form>
              </div>
            </section>
          </div>

          <div class="system-grid">
            <article class="panel sys"><small>HONO API</small><strong :class="apiStatus === 'online' ? 'green' : 'red'">{{ apiStatus === 'checking' ? 'Checking' : apiStatus === 'online' ? 'Online' : 'Offline' }}</strong><p>除登录和 Health 外，所有管理 API 均要求 Session。</p></article>
            <article class="panel sys"><small>DATABASE</small><strong>Cloudflare D1</strong><p>保存商品、Listing、SKU、Monitor、设置与站内信。</p></article>
            <article class="panel sys"><small>QUEUE</small><strong>price-monitor-checks</strong><p>批量检测异步执行；提交任务不等于已经检测完成。</p></article>
            <article class="panel sys"><small>CRON · UTC</small><strong>01:00 / 07:00 / 13:00</strong><p>对应北京时间 09:00 / 15:00 / 21:00。</p></article>
          </div>
        </template>
      </main>
    </section>

    <el-dialog v-model="productDlg" title="新增商品" width="620px">
      <el-form label-position="top"><el-form-item label="商品名称"><el-input v-model="pf.name" /></el-form-item><div class="two"><el-form-item label="品牌"><el-select v-model="pf.brandId" style="width: 100%"><el-option v-for="b in brands" :key="b.id" :label="b.name" :value="b.id" /></el-select></el-form-item><el-form-item label="上游厂家"><el-select v-model="pf.supplierId" clearable style="width: 100%"><el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" /></el-select></el-form-item></div><el-form-item label="1688 商品链接"><el-input v-model="pf.supplierProductUrl" /></el-form-item><el-form-item label="备注"><el-input v-model="pf.note" type="textarea" :rows="3" /></el-form-item></el-form>
      <template #footer><el-button @click="productDlg = false">取消</el-button><el-button type="primary" @click="addProduct">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="brandDlg" title="新增品牌" width="500px">
      <el-form label-position="top"><el-form-item label="品牌名称"><el-input v-model="bf.name" /></el-form-item><el-form-item label="备注"><el-input v-model="bf.note" type="textarea" /></el-form-item></el-form>
      <template #footer><el-button @click="brandDlg = false">取消</el-button><el-button type="primary" @click="addBrand">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="supplierDlg" title="新增厂家" width="560px">
      <el-form label-position="top"><el-form-item label="厂家名称"><el-input v-model="sf.name" /></el-form-item><el-form-item label="1688 店铺名称"><el-input v-model="sf.shopName" /></el-form-item><el-form-item label="1688 店铺首页"><el-input v-model="sf.shopUrl" /></el-form-item><el-form-item label="备注"><el-input v-model="sf.note" type="textarea" /></el-form-item></el-form>
      <template #footer><el-button @click="supplierDlg = false">取消</el-button><el-button type="primary" @click="addSupplier">创建</el-button></template>
    </el-dialog>

    <el-dialog
      v-model="rulePresetDlg"
      :title="editingRulePresetId ? '编辑常用规则' : '新增常用规则'"
      width="680px"
    >
      <el-form label-position="top">
        <div class="two">
          <el-form-item label="规则名称">
            <el-input v-model="rulePresetForm.name" placeholder="例如：最低比官方便宜 3 元" />
          </el-form-item>
          <el-form-item label="规则表达式">
            <el-input v-model="rulePresetForm.expression" placeholder="例如：own >= official - 3" />
          </el-form-item>
        </div>
        <el-alert
          type="info"
          :closable="false"
          title="可使用 official、own、+ - * /、比较符号以及 && / ||。保存时后端会校验表达式。"
        />
      </el-form>

      <div class="preset-list">
        <div class="preset-list-head">已保存的常用规则</div>
        <div v-for="preset in rulePresets" :key="preset.id" class="preset-row">
          <div>
            <b>{{ preset.name }}</b>
            <code>{{ preset.expression }}</code>
          </div>
          <div class="preset-actions">
            <el-button text type="primary" @click="useRulePreset(preset); rulePresetDlg = false">使用</el-button>
            <el-button text @click="editRulePreset(preset)">编辑</el-button>
            <el-button text type="danger" @click="deleteRulePreset(preset)">删除</el-button>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="rulePresetDlg = false">取消</el-button>
        <el-button type="primary" :loading="rulePresetSaving" @click="saveRulePreset">
          {{ editingRulePresetId ? '保存修改' : '新增常用规则' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resultVisible" title="实时检测结果" width="560px">
      <div v-if="result" class="result">
        <el-tag :type="statusType(result.status)" round>{{ statusText(result.status) }}</el-tag>
        <div v-if="result.official && result.own" class="prices">
          <div>
            <span>官方价格</span>
            <b>¥{{ result.official.price.toFixed(2) }}</b>
            <a :href="result.official.url" target="_blank" rel="noreferrer">{{ result.official.name }} ↗</a>
          </div>
          <i>→</i>
          <div>
            <span>自店价格</span>
            <b>¥{{ result.own.price.toFixed(2) }}</b>
            <a :href="result.own.url" target="_blank" rel="noreferrer">{{ result.own.name }} ↗</a>
          </div>
        </div>
        <code v-if="result.ruleExpression">{{ result.ruleExpression }}</code>
        <el-alert v-if="result.error" type="warning" :closable="false" :title="result.error" />
      </div>
    </el-dialog>
  </div>
</template>
