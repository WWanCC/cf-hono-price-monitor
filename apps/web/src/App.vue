<script setup lang="ts">
/**
 * Web 管理端顶层壳组件。
 *
 * App.vue 只负责：
 * - 登录态初始化；
 * - 左侧导航；
 * - 未读通知数量；
 * - 动态挂载具体业务页面。
 *
 * 商品、监控、规则等业务逻辑都放在 pages/ 中，避免再次退化成一个巨型组件。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

import { api, ApiError, type AdminUser } from './api'
import BrandsPage from './pages/BrandsPage.vue'
import ListingsPage from './pages/ListingsPage.vue'
import MonitorsPage from './pages/MonitorsPage.vue'
import NotificationsPage from './pages/NotificationsPage.vue'
import ProductsPage from './pages/ProductsPage.vue'
import RulesPage from './pages/RulesPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import SuppliersPage from './pages/SuppliersPage.vue'
import { showError } from './ui'

type Page =
  | 'brands'
  | 'suppliers'
  | 'products'
  | 'listings'
  | 'monitors'
  | 'rules'
  | 'notifications'
  | 'settings'

const user = ref<AdminUser | null>(null)
const checking = ref(true)
const page = ref<Page>('products')
const unread = ref(0)

const UNREAD_REFRESH_MS = 10_000
let unreadRefreshTimer: number | undefined

const loginForm = reactive({
  username: 'admin',
  password: '',
})

const pageMap = {
  brands: BrandsPage,
  suppliers: SuppliersPage,
  products: ProductsPage,
  listings: ListingsPage,
  monitors: MonitorsPage,
  rules: RulesPage,
  notifications: NotificationsPage,
  settings: SettingsPage,
}

const currentComponent = computed(() => pageMap[page.value])

async function refreshUnread() {
  if (!user.value) return

  try {
    unread.value = (await api.unreadCount()).count
  } catch {
    // 未读数量属于辅助信息，失败时不阻断主页面。
  }
}

async function bootstrap() {
  try {
    user.value = await api.me()
    await refreshUnread()
  } catch (error) {
    // 未登录是正常启动状态；其他错误才需要提示。
    if (!(error instanceof ApiError && error.status === 401)) {
      showError(error)
    }
  } finally {
    checking.value = false
  }
}

async function login() {
  try {
    user.value = await api.login(loginForm)
    loginForm.password = ''
    ElMessage.success('登录成功')
    await refreshUnread()
  } catch (error) {
    showError(error)
  }
}

async function logout() {
  try {
    await api.logout()
  } catch {
    // 即便后端退出请求失败，也清空当前浏览器页面的登录态。
  }

  user.value = null
  unread.value = 0
}

function navigate(value: string) {
  page.value = value as Page

  if (value === 'notifications') {
    void refreshUnread()
  }
}

onMounted(async () => {
  await bootstrap()

  unreadRefreshTimer = window.setInterval(
    refreshUnread,
    UNREAD_REFRESH_MS,
  )
})

onUnmounted(() => {
  if (unreadRefreshTimer !== undefined) {
    window.clearInterval(unreadRefreshTimer)
  }
})
</script>

<template>
  <div v-if="checking" class="center-screen">
    <el-icon class="is-loading" :size="28">
      <Loading />
    </el-icon>
  </div>

  <div v-else-if="!user" class="login-page">
    <el-card class="login-card">
      <h1>价格监控管理端</h1>
      <p>Cloudflare Worker + D1</p>

      <el-form @submit.prevent="login">
        <el-form-item>
          <el-input
            v-model="loginForm.username"
            placeholder="管理员账号"
          />
        </el-form-item>

        <el-form-item>
          <el-input
            v-model="loginForm.password"
            type="password"
            show-password
            placeholder="密码"
            @keyup.enter="login"
          />
        </el-form-item>

        <el-button type="primary" class="full" @click="login">
          登录
        </el-button>
      </el-form>
    </el-card>
  </div>

  <el-container v-else class="app-shell">
    <el-aside width="220px" class="sidebar">
      <div class="brand">
        <strong>Price Monitor</strong>
        <small>v1.6.1</small>
      </div>

      <el-menu
        :default-active="page"
        class="nav"
        @select="navigate"
      >
        <el-menu-item index="products">商品管理</el-menu-item>
        <el-menu-item index="brands">品牌管理</el-menu-item>
        <el-menu-item index="suppliers">上游厂家</el-menu-item>
        <el-menu-item index="listings">商品链接 / SKU</el-menu-item>
        <el-menu-item index="monitors">价格监控</el-menu-item>
        <el-menu-item index="rules">常用规则</el-menu-item>
        <el-menu-item index="notifications">
          <span>站内信</span>
          <el-badge
            v-if="unread"
            :value="unread"
            class="menu-badge"
          />
        </el-menu-item>
        <el-menu-item index="settings">系统设置</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="topbar">
        <span>管理员：{{ user.username }}</span>
        <el-button link @click="logout">退出登录</el-button>
      </el-header>

      <el-main class="main">
        <component :is="currentComponent" />
      </el-main>
    </el-container>
  </el-container>
</template>
